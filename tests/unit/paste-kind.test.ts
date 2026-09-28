import { describe, expect, it } from "vitest";
import { pasteKind } from "../../src/lib/analysis/paste-kind";

describe("pasteKind", () => {
	it("reads a board of eight ranks as a FEN", () => {
		expect(pasteKind("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")).toBe("fen");
		expect(pasteKind("  8/8/8/8/8/8/8/8 w - - 0 1\n")).toBe("fen");
		expect(pasteKind("x/x/x/x/x/x/x/x")).toBe("fen");
	});

	it("reads a one-line PGN with a drawn result as PGN", () => {
		expect(pasteKind("1. d4 d5 2. c4 1/2-1/2")).toBe("pgn");
	});

	it("reads headers, multi-line text and a short slash text as PGN", () => {
		expect(pasteKind('[Event "x"]\n\n1. e4 *')).toBe("pgn");
		expect(pasteKind("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1\n1. e4")).toBe(
			"pgn",
		);
		expect(pasteKind("not/a/fen")).toBe("pgn");
		expect(pasteKind(`${"8/".repeat(7)}8 ${"x".repeat(300)}`)).toBe("pgn");
	});
});
