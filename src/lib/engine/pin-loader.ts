import { PIN_CACHE_NAME } from "$lib/pins/cache-key";
import type { PinId } from "$lib/pins/types";
import type { WasmLoader } from "../../../vendor/avalanche-web-abi1/src/worker-host.ts";
import type { PinUnavailableError as PinUnavailableErrorContract } from "./types";

const MESSAGE_PREFIX = "Pin not in Cache Storage: ";

const CACHE_KEY_PIN_ID = /^\/engines\/([^/?]+)\/avalanche\.wasm(?:\?.*)?$/;

export class PinUnavailableError extends Error implements PinUnavailableErrorContract {
	override readonly name = "PinUnavailableError";
	readonly pinId: PinId;

	constructor(pinId: PinId) {
		super(`${MESSAGE_PREFIX}${pinId}`);
		this.pinId = pinId;
	}

	static fromMessage(message: string): PinUnavailableError | undefined {
		return message.startsWith(MESSAGE_PREFIX)
			? new PinUnavailableError(message.slice(MESSAGE_PREFIX.length))
			: undefined;
	}
}

export function pinIdFromCacheKey(key: string): PinId {
	return CACHE_KEY_PIN_ID.exec(key)?.[1] ?? key;
}

export function createPinLoader(caches: CacheStorage): WasmLoader {
	return async (url) => {
		const cache = await caches.open(PIN_CACHE_NAME);
		const response = await cache.match(url);
		if (!response) throw new PinUnavailableError(pinIdFromCacheKey(url));
		return response;
	};
}
