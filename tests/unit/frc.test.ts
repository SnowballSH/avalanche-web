import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseFen } from "../../src/lib/chess/fen";
import { frcFen, frcNumber, randomFrc } from "../../src/lib/chess/frc";

const fixture = readFileSync(new URL("../fixtures/scharnagl-960.txt", import.meta.url), "utf8")
	.split("\n")
	.filter((line) => line.length > 0 && !line.startsWith("#"))
	.map((line) => {
		const [number, rank] = line.split(" ") as [string, string];
		return { number: Number(number), rank };
	});

const whiteRank = (fen: string): string => (fen.split("/")[7] as string).split(" ")[0] as string;

describe("frcFen", () => {
	it("matches every Scharnagl number in the reference table", () => {
		expect(fixture).toHaveLength(960);
		for (const { number, rank } of fixture) {
			expect(whiteRank(frcFen(number)), `position ${number}`).toBe(rank);
		}
	});

	it("produces a full FEN with mirrored ranks, all castling rights and white to move", () => {
		expect(frcFen(518)).toBe("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
		expect(frcFen(0)).toBe("bbqnnrkr/pppppppp/8/8/8/8/PPPPPPPP/BBQNNRKR w KQkq - 0 1");
		expect(frcFen(959)).toBe("rkrnnqbb/pppppppp/8/8/8/8/PPPPPPPP/RKRNNQBB w KQkq - 0 1");
	});

	it("produces positions chessops accepts as legal", () => {
		for (let n = 0; n < 960; n += 1) expect(parseFen(frcFen(n)).ok, `position ${n}`).toBe(true);
	});

	it("rejects numbers outside 0–959 and non-integers", () => {
		for (const n of [-1, 960, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(() => frcFen(n)).toThrow(RangeError);
		}
	});
});

describe("frcNumber", () => {
	it("inverts frcFen for every number", () => {
		for (let n = 0; n < 960; n += 1) expect(frcNumber(frcFen(n))).toBe(n);
	});

	it("returns undefined for a position that is not a Chess960 start", () => {
		expect(frcNumber("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1")).toBeUndefined();
		expect(frcNumber("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1")).toBeUndefined();
		expect(frcNumber("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1")).toBeUndefined();
		expect(frcNumber("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBKQBNR w KQkq - 0 1")).toBeUndefined();
		expect(frcNumber("not a fen")).toBeUndefined();
		expect(frcNumber("")).toBeUndefined();
	});

	it("ignores the move counters", () => {
		expect(frcNumber("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 7 30")).toBe(518);
	});
});

describe("randomFrc", () => {
	it("returns integers in 0–959", () => {
		for (let i = 0; i < 500; i += 1) {
			const n = randomFrc();
			expect(Number.isInteger(n)).toBe(true);
			expect(n).toBeGreaterThanOrEqual(0);
			expect(n).toBeLessThan(960);
		}
	});
});
