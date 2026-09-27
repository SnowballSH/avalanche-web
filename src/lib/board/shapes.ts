import type { DrawShape } from "@lichess-org/chessground/draw";
import type { Key } from "@lichess-org/chessground/types";
import type { UciMove } from "$lib/engine/types";

export const BEST_MOVE_BRUSH = "paleBlue";

const SQUARE = /^[a-h][1-8]$/;

const asKey = (text: string): Key | undefined => (SQUARE.test(text) ? (text as Key) : undefined);

export const uciKeys = (uci: UciMove): [Key, Key] | undefined => {
	const orig = asKey(uci.slice(0, 2));
	const dest = asKey(uci.slice(2, 4));
	return orig && dest ? [orig, dest] : undefined;
};

export const lastMoveKeys = (uci: UciMove | null | undefined): [Key, Key] | undefined =>
	uci ? uciKeys(uci) : undefined;

export const bestMoveArrow = (pv: readonly UciMove[]): DrawShape | undefined => {
	const first = pv[0];
	const keys = first === undefined ? undefined : uciKeys(first);
	return keys && { orig: keys[0], dest: keys[1], brush: BEST_MOVE_BRUSH };
};
