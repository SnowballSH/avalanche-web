import { describe, expect, it } from "vitest";
import { isPromotion, legalDests, moveUci, turnOf } from "../../src/lib/board/moves";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const CASTLING = "r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1";
const PROMOTION = "8/4P3/8/8/8/8/8/k6K w - - 0 1";

describe("turnOf", () => {
	it("reads the side to move", () => {
		expect(turnOf(START)).toBe("white");
		expect(turnOf("8/8/8/8/8/8/8/K6k b - - 0 1")).toBe("black");
	});
});

describe("legalDests", () => {
	it("lists the legal destinations of the side to move", () => {
		const dests = legalDests(START, false);
		expect(dests.get("e2")).toEqual(["e3", "e4"]);
		expect(dests.get("g1")).toEqual(expect.arrayContaining(["f3", "h3"]));
		expect(dests.has("e7")).toBe(false);
	});

	it("offers both castling representations in standard chess", () => {
		const dests = legalDests(CASTLING, false);
		expect(dests.get("e1")).toEqual(expect.arrayContaining(["g1", "h1", "c1", "a1"]));
	});

	it("offers only king-onto-rook castling in Chess960", () => {
		const dests = legalDests(CASTLING, true);
		expect(dests.get("e1")).toEqual(expect.arrayContaining(["h1", "a1"]));
		expect(dests.get("e1")).not.toContain("g1");
		expect(dests.get("e1")).not.toContain("c1");
	});
});

describe("moveUci", () => {
	it("encodes a plain move and a promotion", () => {
		expect(moveUci(START, "e2", "e4", false)).toBe("e2e4");
		expect(moveUci(PROMOTION, "e7", "e8", false, "queen")).toBe("e7e8q");
		expect(moveUci(PROMOTION, "e7", "e8", false, "knight")).toBe("e7e8n");
	});

	it("normalises castling to the king's two-square move in standard chess", () => {
		expect(moveUci(CASTLING, "e1", "h1", false)).toBe("e1g1");
		expect(moveUci(CASTLING, "e1", "g1", false)).toBe("e1g1");
		expect(moveUci(CASTLING, "e1", "a1", false)).toBe("e1c1");
	});

	it("normalises castling to king-takes-rook in Chess960", () => {
		expect(moveUci(CASTLING, "e1", "h1", true)).toBe("e1h1");
		expect(moveUci(CASTLING, "e1", "a1", true)).toBe("e1a1");
	});
});

describe("isPromotion", () => {
	it("is true only for a pawn reaching the last rank", () => {
		expect(isPromotion(PROMOTION, "e7", "e8")).toBe(true);
		expect(isPromotion(START, "e2", "e4")).toBe(false);
		expect(isPromotion("8/8/8/8/8/8/4R3/k6K w - - 0 1", "e2", "e8")).toBe(false);
	});
});
