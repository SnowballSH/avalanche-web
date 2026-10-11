import { describe, expect, it } from "vitest";
import { PIN_CACHE_NAME, parsePinCacheKey, pinCacheKey } from "../../src/lib/pins/cache-key";
import type { PinCacheKey, PinCacheKeyFn, PinCacheName, PinEntry } from "../../src/lib/pins/types";

const pin: PinEntry = {
	id: "v5.0.0-3274054",
	commit: "327405485fd943dbf0ccaac5539d3841d6e3e1a4",
	label: "5.0.0",
	date: "2026-10-11",
	sha256: "ab".repeat(32),
	bytes: 25_617_474,
};

describe("pin cache key", () => {
	it("names the versioned cache", () => {
		const name: PinCacheName = PIN_CACHE_NAME;
		expect(name).toBe("avalanche-pins-v1");
	});

	it("keys a pin by id and sha256", () => {
		const keyFn: PinCacheKeyFn = pinCacheKey;
		const key: PinCacheKey = keyFn(pin);
		expect(key).toBe(`/engines/v5.0.0-3274054/avalanche.wasm?sha256=${"ab".repeat(32)}`);
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
		expect(parsePinCacheKey("/engines/v5.0.0-3274054/avalanche.wasm")).toBeUndefined();
		expect(
			parsePinCacheKey(`/engines/a/b/avalanche.wasm?sha256=${"ab".repeat(32)}`),
		).toBeUndefined();
		expect(parsePinCacheKey(`/engines/x/avalanche.wasm?sha256=${"AB".repeat(32)}`)).toBeUndefined();
	});
});
