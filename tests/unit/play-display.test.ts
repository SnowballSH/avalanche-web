import { describe, expect, it } from "vitest";
import { createGameTree } from "../../src/lib/chess/tree";
import { formatClock, moveRows, resultText } from "../../src/lib/play/display";

describe("play display", () => {
	it("formats clocks with tenths under ten seconds", () => {
		expect(formatClock(300_000)).toBe("5:00");
		expect(formatClock(61_999)).toBe("1:01");
		expect(formatClock(10_000)).toBe("0:10");
		expect(formatClock(9_950)).toBe("0:09.9");
		expect(formatClock(-5)).toBe("0:00.0");
		expect(formatClock(3_723_000)).toBe("1:02:03");
	});

	it("describes results", () => {
		expect(resultText({ winner: "white", reason: "checkmate" })).toBe("White wins by checkmate");
		expect(resultText({ winner: "black", reason: "flag" })).toBe("Black wins on time");
		expect(resultText({ winner: "draw", reason: "threefold" })).toBe(
			"Draw by threefold repetition",
		);
	});

	it("pairs moves into numbered rows, starting with Black when Black moves first", () => {
		const tree = createGameTree({
			kind: "fen",
			fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
		});
		let node = tree.root;
		for (const move of ["e7e5", "g1f3", "b8c6"]) node = tree.addMove(node, move);
		expect(moveRows(tree)).toEqual([
			{ number: 1, white: null, black: "e5" },
			{ number: 2, white: "Nf3", black: "Nc6" },
		]);
	});
});
