import { type ParsedPinCacheKey, PIN_CACHE_NAME, parsePinCacheKey, pinCacheKey } from "./cache-key";
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

class Transfer {
	fraction = 0;
	cancelled = false;
	reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
	promise: Promise<void> = Promise.resolve();
	readonly listeners = new Set<PinProgressListener>();

	constructor(
		readonly pin: PinEntry,
		readonly key: PinCacheKey,
	) {}

	report(fraction: number): void {
		this.fraction = fraction;
		for (const listener of this.listeners) {
			try {
				listener(fraction);
			} catch {}
		}
	}

	async cancel(): Promise<void> {
		this.cancelled = true;
		await this.reader?.cancel().catch(() => undefined);
	}
}

interface CachedEntry extends ParsedPinCacheKey {
	readonly request: Request;
}

function pinWasmUrl(pin: PinEntry): string {
	return `/engines/${pin.id}/avalanche.wasm`;
}

function cacheKeyOf(request: Request): string {
	const url = new URL(request.url);
	return `${url.pathname}${url.search}`;
}

function contentTypeOf(response: Response): string {
	return (response.headers.get("Content-Type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

async function entryBytes(cache: Cache, request: Request): Promise<number> {
	const response = await cache.match(request);
	if (!response) return 0;
	const declared = Number(response.headers.get("Content-Length"));
	return Number.isInteger(declared) && declared > 0 ? declared : (await response.blob()).size;
}

async function pinEntries(cache: Cache): Promise<CachedEntry[]> {
	const entries: CachedEntry[] = [];
	for (const request of await cache.keys()) {
		const parsed = parsePinCacheKey(cacheKeyOf(request));
		if (parsed) entries.push({ ...parsed, request });
	}
	return entries;
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

	function deletedWhileDownloading(transfer: Transfer): PinStoreError {
		return new PinStoreError("missing", transfer.pin.id, "deleted while downloading");
	}

	async function receive(transfer: Transfer): Promise<Uint8Array<ArrayBuffer>> {
		const { pin } = transfer;
		const network = (message: string, cause?: unknown): PinStoreError =>
			new PinStoreError("network", pin.id, message, cause === undefined ? undefined : { cause });
		let response: Response;
		try {
			response = await fetchFn(pinWasmUrl(pin), { cache: "no-store" });
		} catch (cause) {
			throw network("fetch failed", cause);
		}
		if (!response.ok) throw network(`HTTP ${response.status}`);
		const contentType = contentTypeOf(response);
		if (contentType !== WASM_CONTENT_TYPE) {
			await response.body?.cancel().catch(() => undefined);
			throw network(`unexpected content type ${contentType || "(none)"}`);
		}
		if (!response.body) throw network("response has no body");

		const buffer = new Uint8Array(pin.bytes);
		let received = 0;
		const reader = response.body.getReader();
		transfer.reader = reader;
		let complete = false;
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				if (received + value.length > pin.bytes) {
					throw new PinStoreError("corrupt", pin.id, `body exceeds ${pin.bytes} bytes`);
				}
				buffer.set(value, received);
				received += value.length;
				transfer.report(received / pin.bytes);
			}
			if (transfer.cancelled) throw deletedWhileDownloading(transfer);
			if (received !== pin.bytes) {
				throw new PinStoreError("corrupt", pin.id, `body is ${received} of ${pin.bytes} bytes`);
			}
			complete = true;
		} catch (cause) {
			if (transfer.cancelled) throw deletedWhileDownloading(transfer);
			if (cause instanceof PinStoreError) throw cause;
			throw network("transfer interrupted", cause);
		} finally {
			if (!complete) await reader.cancel().catch(() => undefined);
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

	async function run(transfer: Transfer): Promise<void> {
		corrupt.delete(transfer.key);
		try {
			const bytes = await receive(transfer);
			await verify(transfer.pin, bytes);
			if (transfer.cancelled) throw deletedWhileDownloading(transfer);
			await persist(transfer.pin, bytes);
		} catch (error) {
			if (error instanceof PinStoreError && error.code === "corrupt") {
				corrupt.set(transfer.key, transfer.pin.id);
			}
			throw error;
		}
	}

	function join(transfer: Transfer, onProgress: PinProgressListener | undefined): Promise<void> {
		if (onProgress) transfer.listeners.add(onProgress);
		return transfer.promise;
	}

	function start(pin: PinEntry, key: PinCacheKey, onProgress?: PinProgressListener): Promise<void> {
		const transfer = new Transfer(pin, key);
		transfer.promise = run(transfer).finally(() => {
			if (transfers.get(key) === transfer) transfers.delete(key);
		});
		transfers.set(key, transfer);
		return join(transfer, onProgress);
	}

	function stateFor(pin: PinEntry, cachedKeys: ReadonlySet<PinCacheKey>): CataloguePinState {
		const key = pinCacheKey(pin);
		const transfer = transfers.get(key);
		if (transfer) return { kind: "downloading", fraction: transfer.fraction };
		if (cachedKeys.has(key)) return { kind: "ready" };
		if (corrupt.has(key)) return { kind: "corrupt" };
		return { kind: "absent" };
	}

	return {
		async list(catalogue: readonly PinEntry[]): Promise<readonly PinStatus[]> {
			const cache = await openCache();
			const entries = await pinEntries(cache);
			const cachedKeys = new Set(entries.map((entry) => entry.key));
			const catalogueKeys = new Set(catalogue.map(pinCacheKey));
			const stale: StalePinStatus[] = [];
			for (const entry of entries) {
				if (catalogueKeys.has(entry.key)) continue;
				const bytes = await entryBytes(cache, entry.request);
				stale.push({ id: entry.id, sha256: entry.sha256, bytes, state: { kind: "stale" } });
			}
			return [...catalogue.map((pin) => ({ pin, state: stateFor(pin, cachedKeys) })), ...stale];
		},

		async download(pin: PinEntry, onProgress?: PinProgressListener): Promise<void> {
			const key = pinCacheKey(pin);
			const inFlight = transfers.get(key);
			if (inFlight) return join(inFlight, onProgress);
			if (await (await openCache()).match(key)) {
				onProgress?.(1);
				return;
			}
			const startedMeanwhile = transfers.get(key);
			if (startedMeanwhile) return join(startedMeanwhile, onProgress);
			return start(pin, key, onProgress);
		},

		async get(pin: PinEntry): Promise<Response> {
			const response = await (await openCache()).match(pinCacheKey(pin));
			if (!response) throw new PinStoreError("missing", pin.id, "not in Cache Storage");
			return response;
		},

		async delete(id: PinId): Promise<void> {
			for (const transfer of transfers.values()) {
				if (transfer.pin.id !== id) continue;
				transfers.delete(transfer.key);
				await transfer.cancel();
			}
			for (const [key, pinId] of corrupt) {
				if (pinId === id) corrupt.delete(key);
			}
			const cache = await openCache();
			for (const entry of await pinEntries(cache)) {
				if (entry.id === id) await cache.delete(entry.request);
			}
		},

		async usage(): Promise<StorageUsage> {
			const cache = await openCache();
			let usedBytes = 0;
			for (const request of await cache.keys()) usedBytes += await entryBytes(cache, request);
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
