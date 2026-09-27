import { opposite } from "chessops/util";
import type { Fen, Score } from "$lib/engine/types";
import { epdOf, parseFen, positionFromFen } from "./fen";
import type { GameResult } from "./types";

const FIFTY_MOVE_HALFMOVES = 100;
const THREEFOLD_OCCURRENCES = 3;

export const DRAW_OFFER_WINDOW_MOVES = 10;
export const DRAW_OFFER_MAX_CP = 20;

const draw = (reason: GameResult["reason"]): GameResult => ({ winner: "draw", reason });

const occurrences = (epd: string, history: readonly Fen[]): number =>
	history.reduce((count, fen) => {
		const parsed = parseFen(fen, { chess960: true });
		return parsed.ok && epdOf(parsed.value.fen) === epd ? count + 1 : count;
	}, 1);

export const adjudicate = (fen: Fen, history: readonly Fen[]): GameResult | undefined => {
	const parsed = parseFen(fen, { chess960: true });
	if (!parsed.ok) return undefined;
	const position = positionFromFen(parsed.value.fen);
	if (position.isCheckmate()) return { winner: opposite(position.turn), reason: "checkmate" };
	if (position.isStalemate()) return draw("stalemate");
	if (position.isInsufficientMaterial()) return draw("insufficient");
	if (position.halfmoves >= FIFTY_MOVE_HALFMOVES) return draw("fifty-move");
	if (occurrences(epdOf(parsed.value.fen), history) >= THREEFOLD_OCCURRENCES) {
		return draw("threefold");
	}
	return undefined;
};

const isQuiet = (score: Score): boolean =>
	score.kind === "cp" && score.bound === undefined && Math.abs(score.value) <= DRAW_OFFER_MAX_CP;

export const drawOfferAccepted = (engineScores: readonly Score[]): boolean =>
	engineScores.length >= DRAW_OFFER_WINDOW_MOVES &&
	engineScores.slice(-DRAW_OFFER_WINDOW_MOVES).every(isQuiet);
