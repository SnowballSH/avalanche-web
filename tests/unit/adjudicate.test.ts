import { describe, expect, it } from "vitest";
import { adjudicate, drawOfferAccepted } from "../../src/lib/chess/adjudicate";
import { createGameTree } from "../../src/lib/chess/tree";
import type { Fen, Score } from "../../src/lib/engine/types";

const STANDARD_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const playOut = (moves: readonly string[]): { fen: Fen; history: Fen[] } => {
	const tree = createGameTree({ kind: "standard" });
	let id = tree.root;
	for (const move of moves) id = tree.addMove(id, move);
	const path = tree.pathTo(id).map((node) => tree.fenAt(node));
	return { fen: path.at(-1) as Fen, history: path.slice(0, -1) };
};

const cp = (value: number): Score => ({ kind: "cp", value });

describe("adjudicate", () => {
	it("returns nothing for an ongoing game", () => {
		expect(adjudicate(STANDARD_FEN, [])).toBeUndefined();
		const { fen, history } = playOut(["e2e4", "e7e5"]);
		expect(adjudicate(fen, history)).toBeUndefined();
	});

	it("detects checkmate with the winner being the side that delivered it", () => {
		const scholars = playOut(["e2e4", "e7e5", "d1h5", "b8c6", "f1c4", "g8f6", "h5f7"]);
		expect(adjudicate(scholars.fen, scholars.history)).toEqual({
			winner: "white",
			reason: "checkmate",
		});
		const fools = playOut(["f2f3", "e7e5", "g2g4", "d8h4"]);
		expect(adjudicate(fools.fen, fools.history)).toEqual({ winner: "black", reason: "checkmate" });
	});

	it("detects stalemate", () => {
		expect(adjudicate("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1", [])).toEqual({
			winner: "draw",
			reason: "stalemate",
		});
	});

	it("detects insufficient material", () => {
		expect(adjudicate("8/8/4k3/8/8/8/2K5/8 w - - 0 1", [])).toEqual({
			winner: "draw",
			reason: "insufficient",
		});
		expect(adjudicate("8/8/4k3/8/8/8/2K5/5B2 w - - 0 1", [])).toEqual({
			winner: "draw",
			reason: "insufficient",
		});
		expect(adjudicate("8/8/4k3/8/8/8/2K5/5R2 w - - 0 1", [])).toBeUndefined();
	});

	it("draws same-coloured bishops but not opposite-coloured bishops or two knights", () => {
		expect(adjudicate("k1b5/8/8/8/8/8/8/K2B4 w - - 0 1", [])).toEqual({
			winner: "draw",
			reason: "insufficient",
		});
		expect(adjudicate("k1b5/8/8/8/8/8/8/K1B5 w - - 0 1", [])).toBeUndefined();
		expect(adjudicate("k7/8/8/8/8/8/8/K1NN4 w - - 0 1", [])).toBeUndefined();
	});

	it("still adjudicates positions with Chess960 castling rights", () => {
		expect(
			adjudicate("bbqnnrkr/pppppppp/8/8/8/8/PPPPPPPP/BBQNNRKR w KQkq - 0 1", []),
		).toBeUndefined();
		const start = "bbqnnrkr/pppppppp/8/8/8/8/PPPPPPPP/BBQNNRKR w KQkq - 0 1";
		expect(adjudicate(start, [start, start])).toEqual({ winner: "draw", reason: "threefold" });
	});

	it("detects the fifty-move rule from the halfmove clock", () => {
		expect(adjudicate("8/8/4k3/8/8/8/2K5/5R2 w - - 100 80", [])).toEqual({
			winner: "draw",
			reason: "fifty-move",
		});
		expect(adjudicate("8/8/4k3/8/8/8/2K5/5R2 w - - 99 80", [])).toBeUndefined();
	});

	it("detects threefold repetition across the history", () => {
		const shuffle = ["g1f3", "g8f6", "f3g1", "f6g8"];
		const twice = playOut([...shuffle, ...shuffle]);
		expect(adjudicate(twice.fen, twice.history)).toEqual({ winner: "draw", reason: "threefold" });
		const once = playOut(shuffle);
		expect(adjudicate(once.fen, once.history)).toBeUndefined();
		const almost = playOut([...shuffle, ...shuffle.slice(0, 3)]);
		expect(adjudicate(almost.fen, almost.history)).toBeUndefined();
	});

	it("does not count a repetition when castling rights differ", () => {
		const { fen, history } = playOut([
			"e2e4",
			"e7e5",
			"e1e2",
			"e8e7",
			"e2e1",
			"e7e8",
			"e1e2",
			"e8e7",
			"e2e1",
			"e7e8",
		]);
		expect(adjudicate(fen, history)).toBeUndefined();
	});

	it("prefers checkmate over the fifty-move rule", () => {
		expect(adjudicate("7k/6Q1/6K1/8/8/8/8/8 b - - 100 80", [])).toEqual({
			winner: "white",
			reason: "checkmate",
		});
	});

	it("returns nothing for an invalid FEN", () => {
		expect(adjudicate("garbage", [])).toBeUndefined();
	});
});

describe("drawOfferAccepted", () => {
	it("accepts ten own scores within ±20 cp", () => {
		expect(drawOfferAccepted(Array.from({ length: 10 }, (_, i) => cp(i * 4 - 20)))).toBe(true);
		expect(drawOfferAccepted([cp(300), ...Array.from({ length: 10 }, () => cp(0))])).toBe(true);
	});

	it("rejects nine scores", () => {
		expect(drawOfferAccepted(Array.from({ length: 9 }, () => cp(0)))).toBe(false);
		expect(drawOfferAccepted([])).toBe(false);
	});

	it("rejects one outlier in the last ten", () => {
		const scores = Array.from({ length: 10 }, () => cp(5));
		scores[3] = cp(21);
		expect(drawOfferAccepted(scores)).toBe(false);
		scores[3] = cp(-21);
		expect(drawOfferAccepted(scores)).toBe(false);
	});

	it("never accepts with a mate score in the window", () => {
		const scores: Score[] = Array.from({ length: 10 }, () => cp(0));
		scores[9] = { kind: "mate", value: 12 };
		expect(drawOfferAccepted(scores)).toBe(false);
		scores[9] = { kind: "mate", value: 0 };
		expect(drawOfferAccepted(scores)).toBe(false);
	});

	it("does not trust a bounded score", () => {
		const scores: Score[] = Array.from({ length: 10 }, () => cp(0));
		scores[4] = { kind: "cp", value: 0, bound: "lower" };
		expect(drawOfferAccepted(scores)).toBe(false);
	});
});
