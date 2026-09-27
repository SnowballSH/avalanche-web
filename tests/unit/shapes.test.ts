import { describe, expect, it } from "vitest";
import { bestMoveArrow, lastMoveKeys, uciKeys } from "../../src/lib/board/shapes";

describe("uciKeys", () => {
	it("splits a plain move and a promotion into its squares", () => {
		expect(uciKeys("e2e4")).toEqual(["e2", "e4"]);
		expect(uciKeys("e7e8q")).toEqual(["e7", "e8"]);
	});

	it("returns nothing for a null move or garbage", () => {
		expect(uciKeys("0000")).toBeUndefined();
		expect(uciKeys("(none)")).toBeUndefined();
		expect(uciKeys("")).toBeUndefined();
		expect(uciKeys("z9a1")).toBeUndefined();
	});
});

describe("bestMoveArrow", () => {
	it("draws the first move of a principal variation as an arrow", () => {
		expect(bestMoveArrow(["g1f3", "d7d5", "d2d4"])).toEqual({
			orig: "g1",
			dest: "f3",
			brush: "paleBlue",
		});
	});

	it("draws the promotion square of a promoting best move", () => {
		expect(bestMoveArrow(["b7b8q"])).toMatchObject({ orig: "b7", dest: "b8" });
	});

	it("draws nothing for an empty or null-move variation", () => {
		expect(bestMoveArrow([])).toBeUndefined();
		expect(bestMoveArrow(["0000"])).toBeUndefined();
	});
});

describe("lastMoveKeys", () => {
	it("maps a move to chessground's last-move pair and nothing to none", () => {
		expect(lastMoveKeys("e1g1")).toEqual(["e1", "g1"]);
		expect(lastMoveKeys(null)).toBeUndefined();
		expect(lastMoveKeys(undefined)).toBeUndefined();
	});
});
