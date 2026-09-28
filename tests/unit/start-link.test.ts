import { describe, expect, it } from "vitest";
import { startFromLink } from "../../src/lib/shared/start-link";

describe("startFromLink", () => {
	it("returns nothing without a fen parameter", () => {
		expect(startFromLink("")).toBeNull();
		expect(startFromLink("?other=1")).toBeNull();
	});

	it("turns a valid fen parameter into a normalised fen start", () => {
		expect(startFromLink("?fen=4k3%2F8%2F8%2F8%2F8%2F8%2F8%2F4K2R+w+K+-+0+1")).toEqual({
			start: { kind: "fen", fen: "4k3/8/8/8/8/8/8/4K2R w K - 0 1" },
			error: null,
		});
	});

	it("falls back to the standard start with the parser's error for an invalid fen", () => {
		const linked = startFromLink("?fen=not%2Fa%2Ffen");
		expect(linked?.start).toEqual({ kind: "standard" });
		expect(linked?.error).toMatch(/^The linked position is invalid: Invalid FEN/);
	});
});
