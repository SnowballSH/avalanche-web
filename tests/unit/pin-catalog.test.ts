import { describe, expect, it } from "vitest";
import { createPinCatalog, parseServedPinCatalogue } from "../../src/lib/pins/catalog";
import { PinCatalogueError } from "../../src/lib/pins/catalogue-source";

const firstPin = {
	id: "master-9b7ee6f",
	commit: "9b7ee6ff829dcfb5ee5e48d8dcb83bd44c26a642",
	label: "4.0.0+ (master, 2026-09-27)",
	date: "2026-09-27",
	sha256: "ab".repeat(32),
	bytes: 25_698_005,
};

const served = { abi: 1, pins: [firstPin] };

function rejection(data: unknown): string {
	try {
		parseServedPinCatalogue(data);
	} catch (error) {
		if (error instanceof PinCatalogueError) return error.message;
		throw error;
	}
	throw new Error("expected the catalogue to be rejected");
}

describe("parseServedPinCatalogue", () => {
	it("accepts a served catalogue with sha256 and bytes per pin", () => {
		expect(parseServedPinCatalogue(served)).toEqual(served);
	});

	it("drops unknown fields", () => {
		const result = parseServedPinCatalogue({
			abi: 1,
			pins: [{ ...firstPin, extra: true }],
			generator: "x",
		});
		expect(result).toEqual(served);
	});

	it("rejects a sha256 that is not 64 lowercase hex characters", () => {
		expect(rejection({ abi: 1, pins: [{ ...firstPin, sha256: "abc" }] })).toMatch(/sha256/);
		expect(
			rejection({ abi: 1, pins: [{ ...firstPin, sha256: firstPin.sha256.toUpperCase() }] }),
		).toMatch(/sha256/);
	});

	it("rejects bytes that are not a positive integer", () => {
		expect(rejection({ abi: 1, pins: [{ ...firstPin, bytes: 0 }] })).toMatch(/bytes/);
		expect(rejection({ abi: 1, pins: [{ ...firstPin, bytes: 1.5 }] })).toMatch(/bytes/);
		expect(rejection({ abi: 1, pins: [{ ...firstPin, bytes: "51" }] })).toMatch(/bytes/);
	});

	it("applies the source rules too", () => {
		expect(rejection({ abi: 2, pins: [firstPin] })).toMatch(/abi/);
		expect(
			rejection({ abi: 1, pins: [firstPin, { ...firstPin, commit: "b".repeat(40) }] }),
		).toMatch(/duplicate id/);
	});
});

function fetchReturning(response: () => Response): { fetchFn: typeof fetch; urls: string[] } {
	const urls: string[] = [];
	const fetchFn = ((input: RequestInfo | URL) => {
		urls.push(String(input));
		return Promise.resolve(response());
	}) as typeof fetch;
	return { fetchFn, urls };
}

describe("createPinCatalog", () => {
	it("loads and validates /engines/pins.json", async () => {
		const { fetchFn, urls } = fetchReturning(() => Response.json(served));
		expect(await createPinCatalog(fetchFn).load()).toEqual(served);
		expect(urls).toEqual(["/engines/pins.json"]);
	});

	it("rejects an HTTP failure with a PinCatalogueError naming the status", async () => {
		const { fetchFn } = fetchReturning(() => new Response("gone", { status: 503 }));
		await expect(createPinCatalog(fetchFn).load()).rejects.toThrowError(
			expect.objectContaining({ name: "PinCatalogueError", message: expect.stringMatching(/503/) }),
		);
	});

	it("rejects a body that is not JSON", async () => {
		const { fetchFn } = fetchReturning(() => new Response("<html>", { status: 200 }));
		await expect(createPinCatalog(fetchFn).load()).rejects.toBeInstanceOf(PinCatalogueError);
	});

	it("rejects a catalogue missing the served measurements", async () => {
		const { sha256: _sha256, ...unmeasured } = firstPin;
		const { fetchFn } = fetchReturning(() => Response.json({ abi: 1, pins: [unmeasured] }));
		await expect(createPinCatalog(fetchFn).load()).rejects.toThrowError(/sha256/);
	});
});
