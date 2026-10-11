import { describe, expect, it } from "vitest";
import source from "../../engines/pins.json";
import {
	PinCatalogueError,
	parsePinCatalogueSource,
	withMeasurements,
} from "../../src/lib/pins/catalogue-source";

const firstPin = {
	id: "v5.0.0-3274054",
	commit: "327405485fd943dbf0ccaac5539d3841d6e3e1a4",
	label: "5.0.0",
	date: "2026-10-11",
};

const valid = { abi: 2, pins: [firstPin] };

function rejection(data: unknown): string {
	try {
		parsePinCatalogueSource(data);
	} catch (error) {
		if (error instanceof PinCatalogueError) return error.message;
		throw error;
	}
	throw new Error("expected the catalogue to be rejected");
}

describe("parsePinCatalogueSource", () => {
	it("accepts the repository catalogue, whose first pin is v5.0.0-3274054", () => {
		expect(parsePinCatalogueSource(source)).toEqual({ abi: 2, pins: [firstPin] });
	});

	it("returns the validated catalogue", () => {
		expect(parsePinCatalogueSource(valid)).toEqual(valid);
	});

	it("rejects an abi other than 2", () => {
		expect(rejection({ ...valid, abi: 1 })).toMatch(/abi/);
		expect(rejection({ ...valid, abi: "2" })).toMatch(/abi/);
	});

	it("rejects a duplicate id", () => {
		expect(
			rejection({ abi: 2, pins: [firstPin, { ...firstPin, commit: "a".repeat(40) }] }),
		).toMatch(/duplicate id "v5.0.0-3274054"/);
	});

	it("rejects a commit that is not 40 lowercase hex characters", () => {
		expect(rejection({ abi: 2, pins: [{ ...firstPin, commit: "3274054" }] })).toMatch(/commit/);
		expect(
			rejection({ abi: 2, pins: [{ ...firstPin, commit: firstPin.commit.toUpperCase() }] }),
		).toMatch(/commit/);
	});

	it("rejects a missing or empty label", () => {
		const { label: _label, ...unlabelled } = firstPin;
		expect(rejection({ abi: 2, pins: [unlabelled] })).toMatch(/label/);
		expect(rejection({ abi: 2, pins: [{ ...firstPin, label: "" }] })).toMatch(/label/);
	});

	it("rejects an id that is not a URL path segment of [a-z0-9.-]", () => {
		expect(rejection({ abi: 2, pins: [{ ...firstPin, id: "v5.0.0/3274054" }] })).toMatch(/id/);
		expect(rejection({ abi: 2, pins: [{ ...firstPin, id: "" }] })).toMatch(/id/);
	});

	it("rejects a date that is not YYYY-MM-DD", () => {
		expect(rejection({ abi: 2, pins: [{ ...firstPin, date: "27 Sep 2026" }] })).toMatch(/date/);
	});

	it("rejects an empty pin list and non-object input", () => {
		expect(rejection({ abi: 2, pins: [] })).toMatch(/pins/);
		expect(rejection(null)).toMatch(/object/);
		expect(rejection([])).toMatch(/object/);
	});

	it("rejects a duplicate commit", () => {
		expect(rejection({ abi: 2, pins: [firstPin, { ...firstPin, id: "other" }] })).toMatch(
			/duplicate commit/,
		);
	});
});

describe("withMeasurements", () => {
	it("adds sha256 and bytes to each pin in catalogue order", () => {
		const served = withMeasurements(parsePinCatalogueSource(valid), (pin) => ({
			sha256: `${pin.id}-digest`,
			bytes: 51,
		}));
		expect(served).toEqual({
			abi: 2,
			pins: [{ ...firstPin, sha256: "v5.0.0-3274054-digest", bytes: 51 }],
		});
	});
});
