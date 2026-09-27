import type { PinCacheKey, PinCacheKeyFn, PinCacheName, PinEntry } from "./types";

export const PIN_CACHE_NAME: PinCacheName = "avalanche-pins-v1";

export const pinCacheKey: PinCacheKeyFn = (pin: PinEntry): PinCacheKey =>
	`/engines/${pin.id}/avalanche.wasm?sha256=${pin.sha256}`;
