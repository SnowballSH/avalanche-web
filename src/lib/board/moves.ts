import type { Dests, Key } from "@lichess-org/chessground/types";
import type { Role } from "chessops";
import { chessgroundDests } from "chessops/compat";
import { parseSquare } from "chessops/util";
import { moveToUci, positionFromFen } from "$lib/chess/fen";
import type { Color } from "$lib/chess/types";
import type { Fen, UciMove } from "$lib/engine/types";

export type PromotionRole = Exclude<Role, "pawn" | "king">;

export const PROMOTION_ROLES: readonly PromotionRole[] = ["queen", "rook", "bishop", "knight"];

export const turnOf = (fen: Fen): Color => (fen.split(" ")[1] === "b" ? "black" : "white");

export const legalDests = (fen: Fen, chess960: boolean): Dests =>
	chessgroundDests(positionFromFen(fen), { chess960 });

const squareOf = (key: Key): number => {
	const square = parseSquare(key);
	if (square === undefined) throw new RangeError(`${key} is not a square`);
	return square;
};

export const moveUci = (
	fen: Fen,
	orig: Key,
	dest: Key,
	chess960: boolean,
	promotion?: PromotionRole,
): UciMove => {
	const from = squareOf(orig);
	const to = squareOf(dest);
	const move = promotion === undefined ? { from, to } : { from, to, promotion };
	return moveToUci(positionFromFen(fen), move, chess960);
};

export const isPromotion = (fen: Fen, orig: Key, dest: Key): boolean => {
	const piece = positionFromFen(fen).board.get(squareOf(orig));
	const rank = dest[1];
	return piece?.role === "pawn" && (rank === "1" || rank === "8");
};

export interface BoardMovable {
	readonly color: Color | "both";
	readonly dests: Dests;
}
