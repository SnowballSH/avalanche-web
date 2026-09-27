import { PIN_CACHE_NAME, pinCacheKey } from "./cache-key";
import { sha256Hex } from "./sha256";
import type {
	CataloguePinState,
	PinCacheKey,
	PinEntry,
	PinId,
	PinProgressListener,
	PinStatus,
	PinStore,
	PinStoreErrorCode,
	PinStoreError as PinStoreErrorContract,
	Sha256Hex,
	StalePinStatus,
	StorageUsage,
} from "./types";

export const WASM_CONTENT_TYPE = "application/wasm";

export class PinStoreError extends Error implements PinStoreErrorContract {
	override readonly name = "PinStoreError";
	readonly code: PinStoreErrorCode;
	readonly pinId: PinId;

	constructor(code: PinStoreErrorCode, pinId: PinId, message: string, options?: ErrorOptions) {
		super(`${pinId}: ${message}`, options);
		this.code = code;
		this.pinId = pinId;
	}
}

const CACHE_KEY = /^\/engines\/([^/?]+)\/avalanche\.wasm\?sha256=([0-9a-f]{64})$/;

interface CachedPin {
	readonly key: PinCacheKey;
	readonly id: PinId;
	readonly sha256: Sha256Hex;
	readonly bytes: number;
}

interface Progress {
	fraction: number;
	readonly listeners: Set<PinProgressListener>;
}

interface Transfer {
	readonly progress: Progress;
	readonly promise: Promise<void>;
}

function pinWasmUrl(pin: PinEntry): string {
	return `/engines/${pin.id}/avalanche.wasm`;
}

function cacheKeyOf(request: Request): string {
	const url = new URL(request.url);
	return `${url.pathname}${url.search}`;
}

function parseCacheKey(key: string): Pick<CachedPin, "key" | "id" | "sha256"> | undefined {
	const match = CACHE_KEY.exec(key);
	if (!match?.[1] || !match[2]) return undefined;
	return { key: key as PinCacheKey, id: match[1], sha256: match[2] };
}

async function cachedBytes(cache: Cache, request: Request): Promise<number> {
	const response = await cache.match(request);
	if (!response) return 0;
	const declared = Number(response.headers.get("Content-Length"));
	return Number.isInteger(declared) && declared > 0 ? declared : (await response.blob()).size;
}

async function cachedPins(cache: Cache): Promise<CachedPin[]> {
	const pins: CachedPin[] = [];
	for (const request of await cache.keys()) {
		const parsed = parseCacheKey(cacheKeyOf(request));
		if (!parsed) continue;
		pins.push({ ...parsed, bytes: await cachedBytes(cache, request) });
	}
	return pins;
}

function isQuotaExceeded(error: unknown): boolean {
	return error instanceof Error && error.name === "QuotaExceededError";
}

export function createPinStore(
	cacheStorage: CacheStorage,
	fetchFn: typeof fetch,
	storageManager: StorageManager,
): PinStore {
	const transfers = new Map<PinCacheKey, Transfer>();
	const corrupt = new Map<PinCacheKey, PinId>();
	let persistence: Promise<boolean> | undefined;

	const openCache = (): Promise<Cache> => cacheStorage.open(PIN_CACHE_NAME);

	async function quotaBytes(): Promise<number | null> {
		try {
			return (await storageManager.estimate()).quota ?? null;
		} catch {
			return null;
		}
	}

	function report(progress: Progress, fraction: number): void {
		progress.fraction = fraction;
		for (const listener of progress.listeners) listener(fraction);
	}

	async function receive(pin: PinEntry, progress: Progress): Promise<Uint8Array<ArrayBuffer>> {
		const network = (message: string, cause?: unknown): PinStoreError =>
			new PinStoreError("network", pin.id, message, cause === undefined ? undefined : { cause });
		let response: Response;
		try {
			response = await fetchFn(pinWasmUrl(pin), { cache: "no-store" });
		} catch (cause) {
			throw network("fetch failed", cause);
		}
		if (!response.ok) throw network(`HTTP ${response.status}`);
		if (!response.body) throw network("response has no body");

		const buffer = new Uint8Array(pin.bytes);
		let received = 0;
		const reader = response.body.getReader();
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				if (received + value.length > pin.bytes) {
					void reader.cancel().catch(() => undefined);
					throw new PinStoreError("corrupt", pin.id, `body exceeds ${pin.bytes} bytes`);
				}
				buffer.set(value, received);
				received += value.length;
				report(progress, received / pin.bytes);
			}
		} catch (cause) {
			if (cause instanceof PinStoreError) throw cause;
			throw network("transfer interrupted", cause);
		}
		if (received !== pin.bytes) {
			throw new PinStoreError("corrupt", pin.id, `body is ${received} of ${pin.bytes} bytes`);
		}
		return buffer;
	}

	async function verify(pin: PinEntry, bytes: Uint8Array): Promise<void> {
		const digest = await sha256Hex(bytes);
		if (digest !== pin.sha256) {
			throw new PinStoreError("corrupt", pin.id, `sha256 ${digest} does not match ${pin.sha256}`);
		}
	}

	async function persist(pin: PinEntry, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
		const response = new Response(bytes, {
			headers: { "Content-Type": WASM_CONTENT_TYPE, "Content-Length": String(bytes.length) },
		});
		try {
			await (await openCache()).put(pinCacheKey(pin), response);
		} catch (cause) {
			if (isQuotaExceeded(cause)) {
				throw new PinStoreError("quota", pin.id, "storage quota exceeded", { cause });
			}
			throw cause;
		}
	}

	async function run(pin: PinEntry, key: PinCacheKey, progress: Progress): Promise<void> {
		corrupt.delete(key);
		try {
			const bytes = await receive(pin, progress);
			await verify(pin, bytes);
			await persist(pin, bytes);
		} catch (error) {
			if (error instanceof PinStoreError && error.code === "corrupt") corrupt.set(key, pin.id);
			throw error;
		}
	}

	function stateFor(pin: PinEntry, cachedKeys: ReadonlySet<PinCacheKey>): CataloguePinState {
		const key = pinCacheKey(pin);
		const transfer = transfers.get(key);
		if (transfer) return { kind: "downloading", fraction: transfer.progress.fraction };
		if (cachedKeys.has(key)) return { kind: "ready" };
		if (corrupt.has(key)) return { kind: "corrupt" };
		return { kind: "absent" };
	}

	return {
		async list(catalogue: readonly PinEntry[]): Promise<readonly PinStatus[]> {
			const cached = await cachedPins(await openCache());
			const cachedKeys = new Set(cached.map((entry) => entry.key));
			const catalogueKeys = new Set(catalogue.map(pinCacheKey));
			const stale: StalePinStatus[] = cached
				.filter((entry) => !catalogueKeys.has(entry.key))
				.map(({ id, sha256, bytes }) => ({ id, sha256, bytes, state: { kind: "stale" } }));
			return [...catalogue.map((pin) => ({ pin, state: stateFor(pin, cachedKeys) })), ...stale];
		},

		download(pin: PinEntry, onProgress?: PinProgressListener): Promise<void> {
			const key = pinCacheKey(pin);
			const existing = transfers.get(key);
			if (existing) {
				if (onProgress) existing.progress.listeners.add(onProgress);
				return existing.promise;
			}
			const progress: Progress = {
				fraction: 0,
				listeners: new Set(onProgress ? [onProgress] : []),
			};
			const promise = run(pin, key, progress).finally(() => transfers.delete(key));
			transfers.set(key, { progress, promise });
			return promise;
		},

		async get(pin: PinEntry): Promise<Response> {
			const response = await (await openCache()).match(pinCacheKey(pin));
			if (!response) throw new PinStoreError("missing", pin.id, "not in Cache Storage");
			return response;
		},

		async delete(id: PinId): Promise<void> {
			const cache = await openCache();
			for (const request of await cache.keys()) {
				if (parseCacheKey(cacheKeyOf(request))?.id === id) await cache.delete(request);
			}
			for (const [key, pinId] of corrupt) {
				if (pinId === id) corrupt.delete(key);
			}
		},

		async usage(): Promise<StorageUsage> {
			const cached = await cachedPins(await openCache());
			const usedBytes = cached.reduce((sum, entry) => sum + entry.bytes, 0);
			return { usedBytes, quotaBytes: await quotaBytes() };
		},

		requestPersistence(): Promise<boolean> {
			persistence ??= (async () => {
				try {
					return await storageManager.persist();
				} catch {
					return false;
				}
			})();
			return persistence;
		},
	};
}
