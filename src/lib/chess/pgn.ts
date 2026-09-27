import type { Color, Move, Position } from "chessops";
import { INITIAL_FEN } from "chessops/fen";
import {
	ChildNode,
	defaultHeaders,
	type Evaluation,
	emptyHeaders,
	type Game,
	isMate,
	makeComment,
	makePgn,
	Node,
	type PgnNodeData,
	PgnParser,
	parseComment,
} from "chessops/pgn";
import { parseSan } from "chessops/san";
import type { Fen, Score, SearchInfo } from "$lib/engine/types";
import { importSizeError, moveToUci, parseFen, positionFromFen } from "./fen";
import { frcFen, frcNumber } from "./frc";
import { createGameTree } from "./tree";
import type {
	ExportOptions,
	GameTree,
	ImportError,
	ImportedGame,
	ImportResult,
	NodeId,
	StartPosition,
} from "./types";

export { MAX_IMPORT_BYTES } from "./fen";

const CHESS960_VARIANTS = new Set(["chess960", "chess 960", "fischerandom", "fischer random"]);
const STANDARD_VARIANTS = new Set(["standard", "chess", "from position", "fromposition"]);
const POSITION_TAGS = new Set(["Variant", "SetUp", "FEN"]);

type PgnGame = Game<PgnNodeData>;

const failure = <T>(error: ImportError): ImportResult<T> => ({ ok: false, error });

const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

const hasContent = (game: PgnGame): boolean =>
	game.headers.size > 0 || game.moves.children.length > 0;

const parseGames = (text: string): ImportResult<readonly PgnGame[]> => {
	const games: PgnGame[] = [];
	let budgetError: ImportError | undefined;
	const parser = new PgnParser((game, error) => {
		if (error) {
			budgetError ??= {
				kind: "malformed",
				message: `Game ${games.length + 1} is too complex to parse (${error.message})`,
				game: games.length,
			};
		} else if (hasContent(game)) {
			games.push(game);
		}
	}, emptyHeaders);
	try {
		parser.parse(text);
	} catch (error) {
		return failure({
			kind: "malformed",
			message: `The PGN could not be parsed: ${errorMessage(error)}`,
		});
	}
	return budgetError ? failure(budgetError) : { ok: true, value: games };
};

const resolveStart = (game: PgnGame, index: number): ImportResult<StartPosition> => {
	const variant = game.headers.get("Variant")?.trim().toLowerCase();
	const fenHeader = game.headers.get("FEN");
	if (variant !== undefined && CHESS960_VARIANTS.has(variant)) {
		const fen = fenHeader ?? INITIAL_FEN;
		const scharnagl = frcNumber(fen);
		if (scharnagl !== undefined) return { ok: true, value: { kind: "frc", scharnagl } };
		const parsed = parseFen(fen, { chess960: true });
		if (!parsed.ok) return failure({ ...parsed.error, game: index });
		return failure({
			kind: "unsupported-variant",
			message: "Chess960 games must start from one of the 960 start positions",
			game: index,
		});
	}
	if (variant !== undefined && !STANDARD_VARIANTS.has(variant)) {
		return failure({
			kind: "unsupported-variant",
			message: `The variant "${game.headers.get("Variant")}" is not supported`,
			game: index,
		});
	}
	if (fenHeader === undefined) return { ok: true, value: { kind: "standard" } };
	const parsed = parseFen(fenHeader);
	if (!parsed.ok) return failure({ ...parsed.error, game: index });
	return { ok: true, value: { kind: "fen", fen: parsed.value.fen } };
};

const sideToMove = (fen: Fen): Color => (fen.split(" ")[1] === "b" ? "black" : "white");

const whiteSign = (turn: Color): number => (turn === "white" ? 1 : -1);

const scoreFromEvaluation = (evaluation: Evaluation, turn: Color): Score =>
	isMate(evaluation)
		? { kind: "mate", value: evaluation.mate * whiteSign(turn) }
		: { kind: "cp", value: Math.round(evaluation.pawns * 100) * whiteSign(turn) };

const evaluationFromInfo = (info: SearchInfo, turn: Color): Evaluation =>
	info.score.kind === "mate"
		? { mate: info.score.value * whiteSign(turn), depth: info.depth }
		: { pawns: (info.score.value * whiteSign(turn)) / 100, depth: info.depth };

const annotate = (tree: GameTree, id: NodeId, comments: readonly string[]): void => {
	const texts: string[] = [];
	let evaluation: Evaluation | undefined;
	for (const raw of comments) {
		const comment = parseComment(raw);
		const text = comment.text.trim();
		if (text.length > 0) texts.push(text);
		evaluation = comment.evaluation ?? evaluation;
	}
	if (texts.length > 0) tree.setComment(id, texts.join(" "));
	if (evaluation) {
		tree.setEval(id, {
			searchId: 0,
			depth: evaluation.depth ?? 0,
			multipv: 1,
			score: scoreFromEvaluation(evaluation, sideToMove(tree.fenAt(id))),
			pv: [],
		});
	}
};

interface Frame {
	readonly node: ChildNode<PgnNodeData>;
	readonly position: Position;
	readonly ply: number;
	readonly parent: NodeId;
}

const illegalMove = (index: number, ply: number, san: string): ImportError => ({
	kind: "illegal-move",
	message: `Game ${index + 1}: the move ${san} at ply ${ply} is illegal`,
	game: index,
	ply,
	san,
});

const replayMoves = (
	game: PgnGame,
	tree: GameTree,
	index: number,
	addMove: (position: Position, move: Move, node: ChildNode<PgnNodeData>, parent: NodeId) => NodeId,
): ImportError | undefined => {
	const pending: Frame[] = [];
	const enqueue = (
		children: readonly ChildNode<PgnNodeData>[],
		position: Position,
		ply: number,
		parent: NodeId,
	): void => {
		for (let i = children.length - 1; i >= 0; i -= 1) {
			pending.push({ node: children[i] as ChildNode<PgnNodeData>, position, ply, parent });
		}
	};
	enqueue(game.moves.children, positionFromFen(tree.fenAt(tree.root)), 0, tree.root);
	while (pending.length > 0) {
		const { node, position, ply, parent } = pending.pop() as Frame;
		const move = parseSan(position, node.data.san);
		if (!move) return illegalMove(index, ply + 1, node.data.san);
		const id = addMove(position, move, node, parent);
		if (node.children.length > 0) {
			const after = position.clone();
			after.play(move);
			enqueue(node.children, after, ply + 1, id);
		}
	}
	return undefined;
};

const buildTree = (game: PgnGame, start: StartPosition, index: number): ImportResult<GameTree> => {
	const tree = createGameTree(start);
	const chess960 = start.kind === "frc";
	annotate(tree, tree.root, game.comments ?? []);
	const error = replayMoves(game, tree, index, (position, move, node, parent) => {
		const id = tree.addMove(parent, moveToUci(position, move, chess960));
		annotate(tree, id, [...(node.data.startingComments ?? []), ...(node.data.comments ?? [])]);
		if (node.data.nags?.length) tree.setNags(id, node.data.nags);
		return id;
	});
	return error ? failure(error) : { ok: true, value: tree };
};

const importedGame = (game: PgnGame, index: number): ImportedGame => {
	let built: ImportResult<GameTree> | undefined;
	return {
		headers: game.headers,
		tree: () => {
			if (!built) {
				const start = resolveStart(game, index);
				built = start.ok ? buildTree(game, start.value, index) : start;
			}
			return built;
		},
	};
};

export const importPgn = (text: string): ImportResult<readonly ImportedGame[]> => {
	const oversized = importSizeError(text);
	if (oversized) return failure(oversized);
	const parsed = parseGames(text);
	if (!parsed.ok) return parsed;
	if (parsed.value.length === 0) {
		return failure({ kind: "no-games", message: "No game was found in the text" });
	}
	return { ok: true, value: parsed.value.map(importedGame) };
};

const exportHeaders = (
	tree: GameTree,
	headers: ReadonlyMap<string, string> | undefined,
): Map<string, string> => {
	const merged = defaultHeaders();
	for (const [key, value] of headers ?? []) {
		if (!POSITION_TAGS.has(key)) merged.set(key, value);
	}
	const start = tree.start;
	if (start.kind === "frc") {
		merged.set("Variant", "Chess960");
		merged.set("SetUp", "1");
		merged.set("FEN", frcFen(start.scharnagl));
	} else if (start.kind === "fen") {
		merged.set("SetUp", "1");
		merged.set("FEN", start.fen);
	}
	return merged;
};

const commentsFor = (tree: GameTree, id: NodeId, evals: boolean): string[] | undefined => {
	const node = tree.node(id);
	const evaluation =
		evals && node.eval ? evaluationFromInfo(node.eval, sideToMove(node.fen)) : undefined;
	if (node.comment === null && !evaluation) return undefined;
	return [
		makeComment({
			...(node.comment !== null ? { text: node.comment } : {}),
			...(evaluation ? { evaluation } : {}),
		}),
	];
};

export const exportPgn = (tree: GameTree, options: ExportOptions): string => {
	const moves = new Node<PgnNodeData>();
	const pending: { id: NodeId; pgnNode: Node<PgnNodeData> }[] = [{ id: tree.root, pgnNode: moves }];
	while (pending.length > 0) {
		const { id, pgnNode } = pending.pop() as { id: NodeId; pgnNode: Node<PgnNodeData> };
		for (const childId of tree.children(id)) {
			const child = tree.node(childId);
			const data: PgnNodeData = { san: child.san ?? "" };
			const comments = commentsFor(tree, childId, options.evals);
			if (comments) data.comments = comments;
			if (child.nags.length > 0) data.nags = [...child.nags];
			const pgnChild = new ChildNode(data);
			pgnNode.children.push(pgnChild);
			pending.push({ id: childId, pgnNode: pgnChild });
		}
	}
	const rootComment = tree.node(tree.root).comment;
	const game: PgnGame = {
		headers: exportHeaders(tree, options.headers),
		moves,
		...(rootComment !== null ? { comments: [rootComment] } : {}),
	};
	return makePgn(game);
};
