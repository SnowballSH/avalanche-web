import { describe, expect, it } from "vitest";
import { navigation } from "../../src/lib/shell/navigation";

describe("shell navigation", () => {
	it("links to the three sections in order", () => {
		expect(navigation.map((item) => item.href)).toEqual(["/analysis", "/play", "/engines"]);
	});
});
