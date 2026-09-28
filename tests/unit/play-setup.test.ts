import { describe, expect, it } from "vitest";
import {
	customTimeControl,
	TIME_CONTROL_PRESETS,
	timeControlLabel,
} from "../../src/lib/play/setup";

describe("time controls", () => {
	it("offers the five presets", () => {
		expect(TIME_CONTROL_PRESETS.map(timeControlLabel)).toEqual([
			"1+0",
			"3+2",
			"5+3",
			"10+5",
			"15+10",
		]);
		expect(TIME_CONTROL_PRESETS[0]).toEqual({ baseMs: 60_000, incrementMs: 0 });
	});

	it("accepts a custom base and increment within bounds", () => {
		expect(customTimeControl(0.5, 1)).toEqual({ baseMs: 30_000, incrementMs: 1_000 });
		expect(customTimeControl(180, 180)).toEqual({ baseMs: 10_800_000, incrementMs: 180_000 });
	});

	it.each([
		[0, 0],
		[0.2, 0],
		[181, 0],
		[Number.NaN, 0],
		[5, -1],
		[5, 1.5],
		[5, 181],
	])("rejects %s minutes plus %s seconds", (minutes, increment) => {
		expect(customTimeControl(minutes, increment)).toBeNull();
	});
});
