import { PinStoreError } from "../../../src/lib/pins/store";
import type {
	PinEntry,
	PinId,
	PinProgressListener,
	PinStatus,
	PinStore,
	Sha256Hex,
	StorageUsage,
} from "../../../src/lib/pins/types";

interface CachedPin {
	readonly sha256: Sha256Hex;
	readonly bytes: number;
}

interface PendingDownload {
	readonly pin: PinEntry;
	readonly promise: Promise<void>;
	readonly resolve: () => void;
	readonly reject: (error: unknown) => void;
	readonly listeners: Set<PinProgressListener>;
	fraction: number;
}

const deletedWhileDownloading = (id: PinId): PinStoreError =>
	new PinStoreError("missing", id, "deleted while downloading");

export const QUOTA_BYTES = 1_000_000_000;

export class FakePinStore implements PinStore {
	readonly cached = new Map<PinId, CachedPin>();
	readonly pending = new Map<PinId, PendingDownload>();
	readonly orphaned: PendingDownload[] = [];
	settleOnDelete = true;
	downloads = 0;
	persistenceRequests = 0;
	persistence: () => Promise<boolean> = async () => false;

	cache(id: PinId, sha256: Sha256Hex, bytes: number): void {
		this.cached.set(id, { sha256, bytes });
	}

	async list(catalogue: readonly PinEntry[]): Promise<readonly PinStatus[]> {
		const ids = new Set(catalogue.map((pin) => pin.id));
		const rows: PinStatus[] = catalogue.map((pin) => {
			const pending = this.pending.get(pin.id);
			if (pending) return { pin, state: { kind: "downloading", fraction: pending.fraction } };
			return { pin, state: { kind: this.cached.has(pin.id) ? "ready" : "absent" } };
		});
		for (const [id, entry] of this.cached) {
			if (!ids.has(id)) rows.push({ id, ...entry, state: { kind: "stale" } });
		}
		return rows;
	}

	download(pin: PinEntry, onProgress?: PinProgressListener): Promise<void> {
		const existing = this.pending.get(pin.id);
		if (existing) {
			if (onProgress) existing.listeners.add(onProgress);
			return existing.promise;
		}
		if (this.cached.has(pin.id)) {
			onProgress?.(1);
			return Promise.resolve();
		}
		this.downloads += 1;
		const { promise, resolve, reject } = Promise.withResolvers<void>();
		const listeners = new Set<PinProgressListener>(onProgress ? [onProgress] : []);
		this.pending.set(pin.id, { pin, promise, resolve, reject, listeners, fraction: 0 });
		return promise;
	}

	progress(id: PinId, fraction: number): void {
		const pending = this.#pending(id);
		pending.fraction = fraction;
		for (const listener of pending.listeners) listener(fraction);
	}

	finish(id: PinId): void {
		const pending = this.#pending(id);
		this.pending.delete(id);
		this.cache(id, pending.pin.sha256, pending.pin.bytes);
		pending.resolve();
	}

	fail(id: PinId, error: unknown): void {
		const pending = this.#pending(id);
		this.pending.delete(id);
		pending.reject(error);
	}

	async get(pin: PinEntry): Promise<Response> {
		if (!this.cached.has(pin.id)) throw new PinStoreError("missing", pin.id, "not cached");
		return new Response(new Uint8Array(pin.bytes));
	}

	async delete(id: PinId): Promise<void> {
		const pending = this.pending.get(id);
		if (pending) {
			this.pending.delete(id);
			if (this.settleOnDelete) pending.reject(deletedWhileDownloading(id));
			else this.orphaned.push(pending);
		}
		this.cached.delete(id);
	}

	async usage(): Promise<StorageUsage> {
		let usedBytes = 0;
		for (const entry of this.cached.values()) usedBytes += entry.bytes;
		return { usedBytes, quotaBytes: QUOTA_BYTES };
	}

	requestPersistence(): Promise<boolean> {
		this.persistenceRequests += 1;
		return this.persistence();
	}

	settleOrphans(): void {
		for (const orphan of this.orphaned.splice(0)) {
			orphan.reject(deletedWhileDownloading(orphan.pin.id));
		}
	}

	#pending(id: PinId): PendingDownload {
		const pending = this.pending.get(id);
		if (!pending) throw new Error(`no download in flight for ${id}`);
		return pending;
	}
}
