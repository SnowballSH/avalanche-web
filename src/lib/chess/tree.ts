import type { Position } from "chessops";
import { INITIAL_FEN, makeFen } from "chessops/fen";
import { makeSanAndPlay } from "chessops/san";
import { parseUci } from "chessops/util";
import type { Fen, SearchInfo, UciMove } from "$lib/engine/types";
import { moveToUci, parseFen, positionFromFen } from "./fen";
import { frcFen } from "./frc";
import type {
	GameNode,
	GameTree,
	IllegalMoveError as IllegalMoveErrorContract,
	ImportError,
	NodeId,
	San,
	StartPosition,
} from "./types";

export class IllegalMoveError extends Error implements IllegalMoveErrorContract {
	override readonly name = "IllegalMoveError";
	readonly fen: Fen;
	readonly uci: UciMove;

	constructor(fen: Fen, uci: UciMove) {
		super(`The move ${uci} is illegal in ${fen}`);
		this.fen = fen;
		this.uci = uci;
	}
}

export class InvalidStartError extends Error {
	override readonly name = "InvalidStartError";
	readonly error: ImportError;

	constructor(error: ImportError) {
		super(error.message);
		this.error = error;
	}
}

const POSITION_CACHE_SIZE = 64;

const startFen = (start: StartPosition): Fen => {
	switch (start.kind) {
		case "standard":
			return INITIAL_FEN;
		case "fen": {
			const parsed = parseFen(start.fen);
			if (!parsed.ok) throw new InvalidStartError(parsed.error);
			return parsed.value.fen;
		}
		case "frc":
			return frcFen(start.scharnagl);
	}
};

class Tree implements GameTree {
	readonly start: StartPosition;
	readonly root: NodeId = 0;
	readonly #chess960: boolean;
	readonly #nodes = new Map<NodeId, GameNode>();
	readonly #children = new Map<NodeId, NodeId[]>();
	readonly #positions = new Map<NodeId, Position>();
	#nextId = 1;

	constructor(start: StartPosition, fen: Fen) {
		this.start = start;
		this.#chess960 = start.kind === "frc";
		this.#nodes.set(this.root, {
			id: this.root,
			parent: null,
			ply: 0,
			move: null,
			san: null,
			fen,
			comment: null,
			nags: [],
			eval: null,
		});
	}

	node(id: NodeId): GameNode {
		const node = this.#nodes.get(id);
		if (!node) throw new RangeError(`No node with id ${id}`);
		return node;
	}

	mainline(): readonly NodeId[] {
		const ids: NodeId[] = [this.root];
		let id = this.root;
		for (;;) {
			const first = this.#children.get(id)?.[0];
			if (first === undefined) return ids;
			ids.push(first);
			id = first;
		}
	}

	children(id: NodeId): readonly NodeId[] {
		this.node(id);
		return [...(this.#children.get(id) ?? [])];
	}

	#positionAt(node: GameNode): Position {
		const cached = this.#positions.get(node.id);
		return cached ? cached.clone() : positionFromFen(node.fen);
	}

	#remember(id: NodeId, position: Position): void {
		this.#positions.set(id, position);
		if (this.#positions.size > POSITION_CACHE_SIZE) {
			const oldest = this.#positions.keys().next().value;
			if (oldest !== undefined) this.#positions.delete(oldest);
		}
	}

	addMove(parentId: NodeId, uci: UciMove): NodeId {
		const parent = this.node(parentId);
		const position = this.#positionAt(parent);
		const move = parseUci(uci);
		if (!move || !position.isLegal(move)) throw new IllegalMoveError(parent.fen, uci);
		const engineUci = moveToUci(position, move, this.#chess960);
		const siblings = this.#children.get(parentId) ?? [];
		const existing = siblings.find((id) => this.node(id).move === engineUci);
		if (existing !== undefined) return existing;
		const san = makeSanAndPlay(position, move);
		const id = this.#nextId;
		this.#nextId += 1;
		this.#nodes.set(id, {
			id,
			parent: parentId,
			ply: parent.ply + 1,
			move: engineUci,
			san,
			fen: makeFen(position.toSetup()),
			comment: null,
			nags: [],
			eval: null,
		});
		this.#children.set(parentId, [...siblings, id]);
		this.#remember(id, position);
		return id;
	}

	promote(id: NodeId): void {
		for (const pathId of this.pathTo(id)) {
			const parent = this.node(pathId).parent;
			if (parent === null) continue;
			const siblings = this.#children.get(parent) ?? [];
			const index = siblings.indexOf(pathId);
			if (index > 0) {
				siblings.splice(index, 1);
				siblings.unshift(pathId);
			}
		}
	}

	deleteFrom(id: NodeId): void {
		const parent = this.node(id).parent;
		if (parent === null) return;
		const siblings = this.#children.get(parent) ?? [];
		siblings.splice(siblings.indexOf(id), 1);
		const pending = [id];
		while (pending.length > 0) {
			const current = pending.pop() as NodeId;
			pending.push(...(this.#children.get(current) ?? []));
			this.#children.delete(current);
			this.#nodes.delete(current);
			this.#positions.delete(current);
		}
	}

	setComment(id: NodeId, text: string | null): void {
		this.#nodes.set(id, { ...this.node(id), comment: text });
	}

	setNags(id: NodeId, nags: readonly number[]): void {
		this.#nodes.set(id, { ...this.node(id), nags: [...nags] });
	}

	setEval(id: NodeId, info: SearchInfo): void {
		this.#nodes.set(id, { ...this.node(id), eval: info });
	}

	pathTo(id: NodeId): readonly NodeId[] {
		const ids: NodeId[] = [];
		let current: NodeId | null = id;
		while (current !== null) {
			ids.push(current);
			current = this.node(current).parent;
		}
		return ids.reverse();
	}

	fenAt(id: NodeId): Fen {
		return this.node(id).fen;
	}

	sanAt(id: NodeId): San | null {
		return this.node(id).san;
	}
}

export const createGameTree = (start: StartPosition): GameTree => new Tree(start, startFen(start));
