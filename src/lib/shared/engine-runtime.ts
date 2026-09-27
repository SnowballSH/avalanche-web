import { createBrowserEngineHost } from "$lib/engine/host";
import { hashCapMb } from "$lib/engine/memory";
import { PinUnavailableError } from "$lib/engine/pin-loader";
import { createScheduler } from "$lib/engine/scheduler";
import { EngineSessionCache } from "$lib/engine/session-cache";
import type { EngineScheduler } from "$lib/engine/types";
import { createPinCatalog } from "$lib/pins/catalog";
import { createPinStore, PinStoreError } from "$lib/pins/store";
import type { PinCatalogData, PinStore } from "$lib/pins/types";

export interface EngineRuntime {
	readonly scheduler: EngineScheduler;
	readonly sessions: EngineSessionCache;
	readonly pins: PinStore;
	catalogue(): Promise<PinCatalogData>;
}

const DEFAULT_HASH_MB = 64;

const browserFetch: typeof fetch = (input, init) => fetch(input, init);

const createRuntime = (): EngineRuntime => {
	const catalog = createPinCatalog(browserFetch);
	let catalogue: Promise<PinCatalogData> | null = null;
	return {
		scheduler: createScheduler(),
		sessions: new EngineSessionCache(createBrowserEngineHost()),
		pins: createPinStore(caches, browserFetch, navigator.storage),
		catalogue() {
			const loading = catalogue ?? catalog.load();
			catalogue = loading;
			loading.catch(() => {
				if (catalogue === loading) catalogue = null;
			});
			return loading;
		},
	};
};

let runtime: EngineRuntime | undefined;

export const browserEngineRuntime = (): EngineRuntime => {
	runtime ??= createRuntime();
	return runtime;
};

export const isCrossOriginIsolated = (): boolean =>
	typeof crossOriginIsolated === "boolean" && crossOriginIsolated;

export const deviceMemoryGb = (): number | undefined =>
	(navigator as Navigator & { readonly deviceMemory?: number }).deviceMemory;

export const defaultHashMb = (): number => Math.min(DEFAULT_HASH_MB, hashCapMb(deviceMemoryGb()));

export const engineErrorMessage = (error: unknown): string => {
	if (error instanceof PinStoreError) {
		switch (error.code) {
			case "quota":
				return "The browser's storage is full. Delete engine versions on the Engines page, then try again.";
			case "network":
				return `The engine download failed (${error.message}). Try again.`;
			case "corrupt":
				return "The downloaded engine did not match its checksum and was discarded. Try again.";
			case "missing":
				return "The engine was removed before its download finished. Try again.";
		}
	}
	if (error instanceof PinUnavailableError) {
		return "The engine is no longer stored in this browser. Try again to download it.";
	}
	return error instanceof Error ? error.message : String(error);
};
