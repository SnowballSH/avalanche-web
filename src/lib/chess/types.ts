import type { Fen, SearchInfo, UciMove } from "$lib/engine/types";

export type Color = "white" | "black";

export type San = string;

export type NodeId = number;

export type StartPosition =
	| { readonly kind: "standard" }
	| { readonly kind: "fen"; readonly fen: Fen }
	| { readonly kind: "frc"; readonly scharnagl: number };

export interface GameNode {
	readonly id: NodeId;
	readonly parent: NodeId | null;
	readonly ply: number;
	readonly move: UciMove | null;
	readonly san: San | null;
	readonly fen: Fen;
	readonly comment: string | null;
	readonly nags: readonly number[];
	readonly eval: SearchInfo | null;
}

export interface IllegalMoveError extends Error {
	readonly name: "IllegalMoveError";
	readonly fen: Fen;
	readonly uci: UciMove;
}

export interface GameTree {
	readonly start: StartPosition;
	readonly root: NodeId;
	node(id: NodeId): GameNode;
	mainline(): readonly NodeId[];
	children(id: NodeId): readonly NodeId[];
	addMove(parentId: NodeId, uci: UciMove): NodeId;
	promote(id: NodeId): void;
	deleteFrom(id: NodeId): void;
	setComment(id: NodeId, text: string | null): void;
	setNags(id: NodeId, nags: readonly number[]): void;
	setEval(id: NodeId, info: SearchInfo): void;
	pathTo(id: NodeId): readonly NodeId[];
	fenAt(id: NodeId): Fen;
	sanAt(id: NodeId): San | null;
}

export type ImportErrorKind =
	| "too-large"
	| "invalid-fen"
	| "illegal-move"
	| "unsupported-variant"
	| "no-games"
	| "malformed";

export interface ImportError {
	readonly kind: ImportErrorKind;
	readonly message: string;
	readonly game?: number;
	readonly ply?: number;
	readonly san?: San;
}

export type ImportResult<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: ImportError };

export interface ParsedFen {
	readonly fen: Fen;
}

export interface ImportedGame {
	readonly headers: ReadonlyMap<string, string>;
	tree(): ImportResult<GameTree>;
}

export interface ExportOptions {
	readonly evals: boolean;
	readonly headers?: ReadonlyMap<string, string>;
}

export type GameResultReason =
	| "checkmate"
	| "stalemate"
	| "threefold"
	| "fifty-move"
	| "insufficient"
	| "flag"
	| "resign"
	| "agreement";

export interface GameResult {
	readonly winner: Color | "draw";
	readonly reason: GameResultReason;
}
