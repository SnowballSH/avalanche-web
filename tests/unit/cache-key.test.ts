import { describe, expect, it } from "vitest";
import { PIN_CACHE_NAME, pinCacheKey } from "../../src/lib/pins/cache-key";
import type { PinCacheKey, PinCacheKeyFn, PinCacheName, PinEntry } from "../../src/lib/pins/types";

const pin: PinEntry = {
	id: "master-8c66796",
	commit: "8c66796067c944c0188c62ee9254b8f421ffd19e",
	label: "4.0.0+ (master, 2026-09-27)",
	date: "2026-09-27",
	sha256: "ab".repeat(32),
	bytes: 50_897_196,
};

describe("pin cache key", () => {
	it("names the versioned cache", () => {
		const name: PinCacheName = PIN_CACHE_NAME;
		expect(name).toBe("avalanche-pins-v1");
	});

	it("keys a pin by id and sha256", () => {
		const keyFn: PinCacheKeyFn = pinCacheKey;
		const key: PinCacheKey = keyFn(pin);
		expect(key).toBe(`/engines/master-8c66796/avalanche.wasm?sha256=${"ab".repeat(32)}`);
	});

	it("changes when the sha256 changes", () => {
		expect(pinCacheKey({ ...pin, sha256: "cd".repeat(32) })).not.toBe(pinCacheKey(pin));
	});
});
