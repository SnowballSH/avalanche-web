import { describe, expect, it } from "vitest";
import { PIN_CACHE_NAME, parsePinCacheKey, pinCacheKey } from "../../src/lib/pins/cache-key";
import type { PinCacheKey, PinCacheKeyFn, PinCacheName, PinEntry } from "../../src/lib/pins/types";

const pin: PinEntry = {
	id: "master-9b7ee6f",
	commit: "9b7ee6ff829dcfb5ee5e48d8dcb83bd44c26a642",
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
		expect(key).toBe(`/engines/master-9b7ee6f/avalanche.wasm?sha256=${"ab".repeat(32)}`);
	});

	it("changes when the sha256 changes", () => {
		expect(pinCacheKey({ ...pin, sha256: "cd".repeat(32) })).not.toBe(pinCacheKey(pin));
	});
});

describe("parsePinCacheKey", () => {
	it("inverts pinCacheKey", () => {
		expect(parsePinCacheKey(pinCacheKey(pin))).toEqual({
			key: pinCacheKey(pin),
			id: pin.id,
			sha256: pin.sha256,
		});
	});

	it("rejects keys that are not in the pin format", () => {
		expect(parsePinCacheKey("/engines/junk.wasm")).toBeUndefined();
		expect(parsePinCacheKey("/engines/master-9b7ee6f/avalanche.wasm")).toBeUndefined();
		expect(
			parsePinCacheKey(`/engines/a/b/avalanche.wasm?sha256=${"ab".repeat(32)}`),
		).toBeUndefined();
		expect(parsePinCacheKey(`/engines/x/avalanche.wasm?sha256=${"AB".repeat(32)}`)).toBeUndefined();
	});
});
