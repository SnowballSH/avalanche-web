import { describe, expect, it } from "vitest";
import { MAX_IMPORT_BYTES, parseFen } from "../../src/lib/chess/fen";

describe("parseFen", () => {
	it("accepts a legal FEN and normalises it", () => {
		expect(parseFen("  rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1\n")).toEqual({
			ok: true,
			value: { fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" },
		});
		expect(parseFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -")).toEqual({
			ok: true,
			value: { fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" },
		});
	});

	it("accepts a Chess960 position with X-FEN castling", () => {
		const result = parseFen("bbqnnrkr/pppppppp/8/8/8/8/PPPPPPPP/BBQNNRKR w KQkq - 0 1");
		expect(result.ok).toBe(true);
	});

	it("rejects malformed text with a typed error", () => {
		for (const text of ["", "garbage", "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP w KQkq - 0 1", "�"]) {
			const result = parseFen(text);
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.error.kind).toBe("invalid-fen");
		}
	});

	it("rejects positions chessops finds illegal", () => {
		for (const text of [
			"8/8/8/8/8/8/8/8 w - - 0 1",
			"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNP w KQkq - 0 1",
			"k7/8/8/8/8/8/8/K6r b - - 0 1",
		]) {
			const result = parseFen(text);
			expect(result.ok, text).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("invalid-fen");
				expect(result.error.message.length).toBeGreaterThan(0);
			}
		}
	});

	it("rejects oversized input without throwing", () => {
		const result = parseFen("8".repeat(MAX_IMPORT_BYTES + 1));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("too-large");
	});
});
