import type { PinCacheKey, PinCacheKeyFn, PinCacheName, PinEntry, PinId, Sha256Hex } from "./types";

export const PIN_CACHE_NAME: PinCacheName = "avalanche-pins-v1";

export const pinCacheKey: PinCacheKeyFn = (pin: PinEntry): PinCacheKey =>
	`/engines/${pin.id}/avalanche.wasm?sha256=${pin.sha256}`;

export interface ParsedPinCacheKey {
	readonly key: PinCacheKey;
	readonly id: PinId;
	readonly sha256: Sha256Hex;
}

const PIN_CACHE_KEY = /^\/engines\/([^/?]+)\/avalanche\.wasm\?sha256=([0-9a-f]{64})$/;

export function parsePinCacheKey(key: string): ParsedPinCacheKey | undefined {
	const match = PIN_CACHE_KEY.exec(key);
	if (!match?.[1] || !match[2]) return undefined;
	return { key: key as PinCacheKey, id: match[1], sha256: match[2] };
}
