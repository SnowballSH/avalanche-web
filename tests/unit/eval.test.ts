import { describe, expect, it } from "vitest";
import {
	evalBarFraction,
	formatScore,
	toWhitePov,
	whitePovAt,
	whiteWinChance,
} from "../../src/lib/board/eval";
import type { Score } from "../../src/lib/engine/types";

const cp = (value: number): Score => ({ kind: "cp", value });
const mate = (value: number): Score => ({ kind: "mate", value });

describe("toWhitePov", () => {
	it("keeps a white-to-move score and negates a black-to-move one", () => {
		expect(toWhitePov(cp(35), "white")).toEqual(cp(35));
		expect(toWhitePov(cp(35), "black")).toEqual(cp(-35));
		expect(toWhitePov(mate(3), "black")).toEqual(mate(-3));
	});

	it("flips a bound when it negates", () => {
		expect(toWhitePov({ kind: "cp", value: 50, bound: "lower" }, "black")).toEqual({
			kind: "cp",
			value: -50,
			bound: "upper",
		});
	});

	it("reads the side to move from a fen", () => {
		expect(whitePovAt("8/8/8/8/8/8/8/K6k b - - 0 1", cp(20))).toEqual(cp(-20));
		expect(whitePovAt("8/8/8/8/8/8/8/K6k w - - 0 1", cp(20))).toEqual(cp(20));
	});
});

describe("whiteWinChance", () => {
	it("is zero at equality, symmetric, and saturates at one", () => {
		expect(whiteWinChance(cp(0))).toBe(0);
		expect(whiteWinChance(cp(100))).toBeCloseTo(-whiteWinChance(cp(-100)), 10);
		expect(whiteWinChance(cp(100))).toBeCloseTo(0.182, 3);
		expect(whiteWinChance(cp(500))).toBeCloseTo(0.726, 3);
		expect(whiteWinChance(cp(100_000))).toBe(1);
		expect(whiteWinChance(cp(-100_000))).toBe(-1);
	});

	it("treats mate as a certain result, with mate zero as the mated side", () => {
		expect(whiteWinChance(mate(5))).toBe(1);
		expect(whiteWinChance(mate(-1))).toBe(-1);
		expect(whiteWinChance(mate(0))).toBe(-1);
	});
});

describe("evalBarFraction", () => {
	it("clamps a huge centipawn lead so a sliver of the losing side remains", () => {
		expect(evalBarFraction(cp(5000))).toBe(0.95);
		expect(evalBarFraction(cp(-5000))).toBe(0.05);
		expect(evalBarFraction(cp(0))).toBe(0.5);
		expect(evalBarFraction(null)).toBe(0.5);
	});

	it("shows mate as a full bar", () => {
		expect(evalBarFraction(mate(2))).toBe(1);
		expect(evalBarFraction(mate(-2))).toBe(0);
	});
});

describe("formatScore", () => {
	it("formats centipawns in pawns with a sign and mate with a hash", () => {
		expect(formatScore(cp(123))).toBe("+1.23");
		expect(formatScore(cp(-5))).toBe("-0.05");
		expect(formatScore(cp(0))).toBe("0.00");
		expect(formatScore(mate(4))).toBe("#4");
		expect(formatScore(mate(-4))).toBe("-#4");
		expect(formatScore(mate(0))).toBe("-#0");
		expect(formatScore(null)).toBe("");
	});
});
