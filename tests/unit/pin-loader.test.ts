import { describe, expect, it } from "vitest";
import { createPinLoader, PinUnavailableError } from "../../src/lib/engine/pin-loader";
import { PIN_CACHE_NAME, pinCacheKey } from "../../src/lib/pins/cache-key";
import type { PinEntry } from "../../src/lib/pins/types";

const pin: PinEntry = {
	id: "master-8c66796",
	commit: "8c66796067c944c0188c62ee9254b8f421ffd19e",
	label: "4.0.0+ (master, 2026-09-27)",
	date: "2026-09-27",
	sha256: "ab".repeat(32),
	bytes: 50_897_196,
};

function fakeCaches(entries: ReadonlyMap<string, Response>): {
	caches: CacheStorage;
	opened: string[];
} {
	const opened: string[] = [];
	const cache = {
		match: (request: RequestInfo | URL) => Promise.resolve(entries.get(String(request))),
	} as unknown as Cache;
	const caches = {
		open: (name: string) => {
			opened.push(name);
			return Promise.resolve(cache);
		},
	} as unknown as CacheStorage;
	return { caches, opened };
}

describe("createPinLoader", () => {
	it("answers the cache key from the pins cache", async () => {
		const response = new Response(new Uint8Array([0, 97, 115, 109]), {
			headers: { "Content-Type": "application/wasm" },
		});
		const { caches, opened } = fakeCaches(new Map([[pinCacheKey(pin), response]]));
		const load = createPinLoader(caches);
		expect(await load(pinCacheKey(pin))).toBe(response);
		expect(opened).toEqual([PIN_CACHE_NAME]);
	});

	it("fails with a PinUnavailableError naming the pin when the entry is gone", async () => {
		const { caches } = fakeCaches(new Map());
		const load = createPinLoader(caches);
		await expect(load(pinCacheKey(pin))).rejects.toThrowError(
			expect.objectContaining({ name: "PinUnavailableError", pinId: pin.id }),
		);
		await expect(load(pinCacheKey(pin))).rejects.toBeInstanceOf(PinUnavailableError);
	});
});

describe("PinUnavailableError", () => {
	it("round-trips through its message across the worker boundary", () => {
		const error = new PinUnavailableError(pin.id);
		const restored = PinUnavailableError.fromMessage(error.message);
		expect(restored?.pinId).toBe(pin.id);
		expect(PinUnavailableError.fromMessage("Failed to load wasm: HTTP 404")).toBeUndefined();
	});
});
