import { describe, expect, it } from "vitest";
import { parseBestMove, parseEngineNotice, parseInfoLine } from "../../src/lib/engine/uci-parse";

describe("parseInfoLine", () => {
	it("parses a cp score line as the engine prints it", () => {
		const line =
			"info depth 6 seldepth 7 multipv 1 score cp 40 nodes 1731 nps 288500 hashfull 0 tbhits 0 time 6 pv e2e4 c7c5 g1f3 b8c6 f1b5";
		expect(parseInfoLine(line, 3)).toEqual({
			searchId: 3,
			depth: 6,
			seldepth: 7,
			multipv: 1,
			score: { kind: "cp", value: 40 },
			nodes: 1731,
			nps: 288500,
			timeMs: 6,
			pv: ["e2e4", "c7c5", "g1f3", "b8c6", "f1b5"],
		});
	});

	it("parses a mate score", () => {
		const line =
			"info depth 8 seldepth 1 multipv 1 score mate 1 nodes 38 nps 38000 hashfull 0 tbhits 0 time 0 pv a1a8";
		expect(parseInfoLine(line, 1)?.score).toEqual({ kind: "mate", value: 1 });
	});

	it("parses a negative mate and a negative cp score", () => {
		expect(
			parseInfoLine("info depth 5 seldepth 9 multipv 1 score mate -3 pv h8g8", 1)?.score,
		).toEqual({
			kind: "mate",
			value: -3,
		});
		expect(parseInfoLine("info depth 5 multipv 1 score cp -128 pv h8g8", 1)?.score).toEqual({
			kind: "cp",
			value: -128,
		});
	});

	it("parses lowerbound and upperbound", () => {
		const lower =
			"info depth 9 seldepth 12 multipv 1 score cp 42 lowerbound nodes 10 nps 20 hashfull 3 tbhits 0 time 500 pv e2e4";
		expect(parseInfoLine(lower, 1)?.score).toEqual({ kind: "cp", value: 42, bound: "lower" });
		const upper = "info depth 9 seldepth 12 multipv 1 score mate -2 upperbound nodes 10 pv e2e4";
		expect(parseInfoLine(upper, 1)?.score).toEqual({ kind: "mate", value: -2, bound: "upper" });
	});

	it("keeps the multipv index of each line", () => {
		const second =
			"info depth 4 seldepth 4 multipv 2 score cp 26 wdl 280 495 225 nodes 870 nps 870000 hashfull 0 tbhits 0 time 1 pv g1f3 d7d5 d2d4 g8f6";
		const info = parseInfoLine(second, 7);
		expect(info?.multipv).toBe(2);
		expect(info?.score).toEqual({ kind: "cp", value: 26 });
		expect(info?.pv).toEqual(["g1f3", "d7d5", "d2d4", "g8f6"]);
	});

	it("omits fields the line does not carry", () => {
		const info = parseInfoLine("info depth 3 score cp 12 pv e2e4", 2);
		expect(info).toEqual({
			searchId: 2,
			depth: 3,
			multipv: 1,
			score: { kind: "cp", value: 12 },
			pv: ["e2e4"],
		});
		expect(info).not.toHaveProperty("seldepth");
		expect(info).not.toHaveProperty("nodes");
	});

	it("parses the terminal line for a position with no legal moves", () => {
		expect(parseInfoLine("info depth 0 score mate 0", 4)).toEqual({
			searchId: 4,
			depth: 0,
			multipv: 1,
			score: { kind: "mate", value: 0 },
			pv: [],
		});
		expect(parseInfoLine("info depth 0 score cp 0 wdl 0 1000 0", 4)).toEqual({
			searchId: 4,
			depth: 0,
			multipv: 1,
			score: { kind: "cp", value: 0 },
			pv: [],
		});
	});

	it("returns undefined for lines without a depth or a score", () => {
		expect(parseInfoLine("info depth 3 currmove e2e4 currmovenumber 1", 1)).toBeUndefined();
		expect(parseInfoLine("info nodes 1000 nps 20000 hashfull 10", 1)).toBeUndefined();
		expect(parseInfoLine("info depth 3 score cp", 1)).toBeUndefined();
		expect(parseInfoLine("info depth x score cp 3", 1)).toBeUndefined();
	});

	it("ignores info string lines and non-info lines", () => {
		expect(parseInfoLine("info string Hash: 16 MB, 0 MB on huge pages", 1)).toBeUndefined();
		expect(parseInfoLine("bestmove e2e4", 1)).toBeUndefined();
		expect(parseInfoLine("readyok", 1)).toBeUndefined();
		expect(parseInfoLine("", 1)).toBeUndefined();
	});

	it("skips unknown tokens and tolerates extra whitespace", () => {
		const info = parseInfoLine(
			"info  depth 2 \t future 9 9 score cp 5 refutation e2e4 pv d2d4  d7d5 ",
			1,
		);
		expect(info?.depth).toBe(2);
		expect(info?.score).toEqual({ kind: "cp", value: 5 });
		expect(info?.pv).toEqual(["d2d4", "d7d5"]);
	});
});

describe("parseBestMove", () => {
	it("parses a move with a ponder move", () => {
		expect(parseBestMove("bestmove e2e4 ponder c7c5", 5)).toEqual({
			searchId: 5,
			move: "e2e4",
			ponder: "c7c5",
		});
	});

	it("parses a move without a ponder move", () => {
		expect(parseBestMove("bestmove a1a8", 5)).toEqual({ searchId: 5, move: "a1a8" });
	});

	it("maps the null move to null", () => {
		expect(parseBestMove("bestmove (none)", 5)).toEqual({ searchId: 5, move: null });
		expect(parseBestMove("bestmove 0000", 5)).toEqual({ searchId: 5, move: null });
	});

	it("returns undefined for other lines", () => {
		expect(parseBestMove("info depth 1 score cp 0 pv e2e4", 5)).toBeUndefined();
		expect(parseBestMove("bestmove", 5)).toBeUndefined();
	});
});

describe("parseEngineNotice", () => {
	it("recognises a failed Hash allocation and the size still in effect", () => {
		expect(
			parseEngineNotice("info string Hash: failed to allocate 1048576 MB, still using 16 MB"),
		).toEqual({ kind: "hash-allocation-failed", requestedMb: 1048576, effectiveMb: 16 });
	});

	it("recognises an engine error", () => {
		expect(parseEngineNotice("info string error: OutOfMemory")).toEqual({
			kind: "engine-error",
			message: "OutOfMemory",
		});
	});

	it("returns undefined for other info string lines", () => {
		expect(parseEngineNotice("info string Hash: 16 MB, 0 MB on huge pages")).toBeUndefined();
		expect(parseEngineNotice("info depth 1 score cp 0 pv e2e4")).toBeUndefined();
		expect(parseEngineNotice("bestmove e2e4")).toBeUndefined();
	});
});
