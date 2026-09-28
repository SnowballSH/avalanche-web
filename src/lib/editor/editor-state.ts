import type { Piece, Setup, SquareName } from "chessops";
import {
	EMPTY_BOARD_FEN,
	INITIAL_FEN,
	makeBoardFen,
	parseBoardFen,
	parseFen as parseSetup,
} from "chessops/fen";
import { makeSquare, parseSquare, squareFile, squareRank } from "chessops/util";
import { analysisLink } from "$lib/analysis/hash-link";
import { parseFen, parseFenSetup } from "$lib/chess/fen";
import type { Color, ImportResult } from "$lib/chess/types";
import type { Fen } from "$lib/engine/types";

export type CastlingRight = "K" | "Q" | "k" | "q";

export const CASTLING_RIGHTS: readonly CastlingRight[] = ["K", "Q", "k", "q"];

export type CastlingRights = Readonly<Record<CastlingRight, boolean>>;

export interface EditorState {
	readonly placement: string;
	readonly turn: Color;
	readonly castling: CastlingRights;
	readonly enPassant: SquareName | null;
	readonly halfmoves: number;
	readonly fullmoves: number;
}

export type EditorTool =
	| { readonly kind: "move" }
	| { readonly kind: "erase" }
	| { readonly kind: "piece"; readonly piece: Piece };

export type EditorValidation =
	| { readonly ok: true; readonly fen: Fen; readonly normalised: boolean }
	| { readonly ok: false; readonly reason: string };

export const PLAY_PATH = "/play";

export const EDITOR_PATH = "/editor";

export const FEN_QUERY_PARAM = "fen";

const NO_CASTLING: CastlingRights = { K: false, Q: false, k: false, q: false };

const KING_FILE = 4;

const castlingRightOf = (rook: number, kingFile: number): CastlingRight => {
	const kingside = squareFile(rook) > kingFile;
	const white = squareRank(rook) === 0;
	if (white) return kingside ? "K" : "Q";
	return kingside ? "k" : "q";
};

const castlingFromSetup = (setup: Setup): CastlingRights => {
	const rights: Record<CastlingRight, boolean> = { ...NO_CASTLING };
	for (const rook of setup.castlingRights) {
		const color = squareRank(rook) === 0 ? "white" : "black";
		const king = setup.board.kingOf(color);
		rights[castlingRightOf(rook, king === undefined ? KING_FILE : squareFile(king))] = true;
	}
	return rights;
};

const fromSetup = (setup: Setup): EditorState => ({
	placement: makeBoardFen(setup.board),
	turn: setup.turn,
	castling: castlingFromSetup(setup),
	enPassant: setup.epSquare === undefined ? null : makeSquare(setup.epSquare),
	halfmoves: setup.halfmoves,
	fullmoves: setup.fullmoves,
});

export const startingEditor = (): EditorState => fromSetup(parseSetup(INITIAL_FEN).unwrap());

export const editorFromFen = (text: string): ImportResult<EditorState> => {
	const setup = parseFenSetup(text);
	return setup.ok ? { ok: true, value: fromSetup(setup.value) } : setup;
};

export const clearBoard = (state: EditorState): EditorState => ({
	...state,
	placement: EMPTY_BOARD_FEN,
	castling: NO_CASTLING,
	enPassant: null,
});

const castlingField = (castling: CastlingRights): string =>
	CASTLING_RIGHTS.filter((right) => castling[right]).join("") || "-";

export const editorFen = (state: EditorState): Fen =>
	[
		state.placement,
		state.turn === "white" ? "w" : "b",
		castlingField(state.castling),
		state.enPassant ?? "-",
		state.halfmoves,
		state.fullmoves,
	].join(" ");

const squareOf = (name: SquareName): number => {
	const square = parseSquare(name);
	if (square === undefined) throw new RangeError(`${name} is not a square`);
	return square;
};

const samePiece = (a: Piece | undefined, b: Piece): boolean =>
	a !== undefined && a.role === b.role && a.color === b.color;

export const applyTool = (
	state: EditorState,
	square: SquareName,
	tool: EditorTool,
): EditorState => {
	if (tool.kind === "move") return state;
	const board = parseBoardFen(state.placement).unwrap();
	const target = squareOf(square);
	if (tool.kind === "erase" || samePiece(board.get(target), tool.piece)) board.take(target);
	else board.set(target, tool.piece);
	return { ...state, placement: makeBoardFen(board) };
};

export const withPlacement = (state: EditorState, placement: string): EditorState =>
	parseBoardFen(placement).isOk ? { ...state, placement } : state;

export const withTurn = (state: EditorState, turn: Color): EditorState =>
	turn === state.turn ? state : { ...state, turn, enPassant: null };

export const withCastling = (
	state: EditorState,
	right: CastlingRight,
	enabled: boolean,
): EditorState => ({ ...state, castling: { ...state.castling, [right]: enabled } });

export const withEnPassant = (state: EditorState, square: SquareName | null): EditorState => ({
	...state,
	enPassant: square,
});

const BOARD_FILES = 8;

export const enPassantCandidates = (state: EditorState): readonly SquareName[] => {
	const board = parseBoardFen(state.placement).unwrap();
	const mover = state.turn === "white" ? "black" : "white";
	const targetRank = state.turn === "white" ? 5 : 2;
	const forward = state.turn === "white" ? 8 : -8;
	const candidates: SquareName[] = [];
	for (let file = 0; file < BOARD_FILES; file++) {
		const target = targetRank * 8 + file;
		const pawn = board.get(target - forward);
		if (pawn?.role !== "pawn" || pawn.color !== mover) continue;
		if (board.occupied.has(target) || board.occupied.has(target + forward)) continue;
		candidates.push(makeSquare(target));
	}
	return candidates;
};

const enPassantProblem = (state: EditorState): string | null => {
	const square = state.enPassant;
	if (square === null || enPassantCandidates(state).includes(square)) return null;
	const mover = state.turn === "white" ? "black" : "white";
	return `The en passant square ${square} needs a ${mover} pawn that has just advanced two squares past it, with both squares it crossed empty`;
};

export const validateEditor = (state: EditorState): EditorValidation => {
	const enPassant = enPassantProblem(state);
	if (enPassant) return { ok: false, reason: enPassant };
	const fen = editorFen(state);
	const parsed = parseFen(fen);
	if (!parsed.ok) return { ok: false, reason: parsed.error.message };
	return { ok: true, fen: parsed.value.fen, normalised: parsed.value.fen !== fen };
};

const withFenQuery = (path: string, fen: Fen): string =>
	`${path}?${new URLSearchParams({ [FEN_QUERY_PARAM]: fen.trim() })}`;

export const playLink = (fen: Fen): string => withFenQuery(PLAY_PATH, fen);

export const editorLink = (fen: Fen): string => withFenQuery(EDITOR_PATH, fen);

export const editorLinks = (fen: Fen): { readonly analysis: string; readonly play: string } => ({
	analysis: analysisLink(fen),
	play: playLink(fen),
});
