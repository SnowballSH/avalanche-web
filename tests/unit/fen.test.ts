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

	it("accepts a Chess960 position with X-FEN castling only when asked for Chess960", () => {
		const fen = "bbqnnrkr/pppppppp/8/8/8/8/PPPPPPPP/BBQNNRKR w KQkq - 0 1";
		expect(parseFen(fen, { chess960: true })).toEqual({ ok: true, value: { fen } });
		const rejected = parseFen(fen);
		expect(rejected.ok).toBe(false);
		if (!rejected.ok) {
			expect(rejected.error.kind).toBe("unsupported-variant");
			expect(rejected.error.message).toMatch(/Chess960|FRC/);
		}
	});

	it("rejects standard-looking castling rights whose king or rook is off the standard squares", () => {
		for (const fen of [
			"1r2k3/8/8/8/8/8/8/4K3 w q - 0 1",
			"r5k1/8/8/8/8/8/8/4K3 w q - 0 1",
			"4k3/8/8/8/8/8/8/R4K2 w Q - 0 1",
		]) {
			const result = parseFen(fen);
			expect(result.ok, fen).toBe(false);
			if (!result.ok) expect(result.error.kind).toBe("unsupported-variant");
		}
	});

	it("accepts a Chess960 position once its castling rights are removed", () => {
		const fen = "bbqnnrkr/pppppppp/8/8/8/8/PPPPPPPP/BBQNNRKR w - - 0 1";
		expect(parseFen(fen)).toEqual({ ok: true, value: { fen } });
	});

	it("leaves standard positions with castling rights unaffected", () => {
		for (const fen of [
			"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
			"r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1",
			"r3k3/8/8/8/8/8/8/4K2R w Kq - 0 1",
		]) {
			expect(parseFen(fen), fen).toEqual({ ok: true, value: { fen } });
		}
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
