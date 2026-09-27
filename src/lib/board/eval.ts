import type { Color } from "$lib/chess/types";
import type { Fen, Score, ScoreBound } from "$lib/engine/types";
import { turnOf } from "./moves";

export type PovScore = Score | { readonly kind: "checkmate"; readonly winner: Color };

const WIN_CHANCE_SLOPE = 0.00368208;
const BAR_MIN = 0.05;
const BAR_MAX = 0.95;

const opposite = (color: Color): Color => (color === "white" ? "black" : "white");

const flipBound = (bound: ScoreBound | undefined): ScoreBound | undefined =>
	bound === undefined ? undefined : bound === "lower" ? "upper" : "lower";

export const toWhitePov = (score: Score, turn: Color): PovScore => {
	if (score.kind === "mate" && score.value === 0) {
		return { kind: "checkmate", winner: opposite(turn) };
	}
	if (turn === "white") return score;
	const bound = flipBound(score.bound);
	return bound === undefined
		? { kind: score.kind, value: -score.value }
		: { kind: score.kind, value: -score.value, bound };
};

export const whitePovAt = (fen: Fen, score: Score): PovScore => toWhitePov(score, turnOf(fen));

export const whiteWinChance = (score: PovScore): number => {
	if (score.kind === "checkmate") return score.winner === "white" ? 1 : -1;
	if (score.kind === "mate") return score.value > 0 ? 1 : -1;
	const chance = 2 / (1 + Math.exp(-WIN_CHANCE_SLOPE * score.value)) - 1;
	return Math.max(-1, Math.min(1, chance));
};

export const evalBarFraction = (score: PovScore | null): number => {
	if (score === null) return 0.5;
	if (score.kind !== "cp") return whiteWinChance(score) > 0 ? 1 : 0;
	const fraction = 0.5 + whiteWinChance(score) / 2;
	return Math.max(BAR_MIN, Math.min(BAR_MAX, fraction));
};

export const formatScore = (score: PovScore | null): string => {
	if (score === null) return "";
	if (score.kind === "checkmate") return score.winner === "white" ? "1-0" : "0-1";
	if (score.kind === "mate") {
		return score.value > 0 ? `#${score.value}` : `-#${Math.abs(score.value)}`;
	}
	const pawns = (score.value / 100).toFixed(2);
	return score.value > 0 ? `+${pawns}` : score.value < 0 ? pawns : "0.00";
};
