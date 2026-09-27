export type PinId = string;

export type Sha256Hex = string;

export type AbiVersion = 1;

export interface PinEntry {
	readonly id: PinId;
	readonly commit: string;
	readonly label: string;
	readonly date: string;
	readonly sha256: Sha256Hex;
	readonly bytes: number;
}

export interface PinCatalogData {
	readonly abi: AbiVersion;
	readonly pins: readonly PinEntry[];
}

export interface PinCatalog {
	load(): Promise<PinCatalogData>;
}

export type PinCacheName = "avalanche-pins-v1";

export type PinCacheKey = `/engines/${PinId}/avalanche.wasm?sha256=${Sha256Hex}`;

export type PinCacheKeyFn = (pin: PinEntry) => PinCacheKey;

export type CataloguePinState =
	| { readonly kind: "absent" }
	| { readonly kind: "downloading"; readonly fraction: number }
	| { readonly kind: "ready" }
	| { readonly kind: "corrupt" };

export type StalePinState = { readonly kind: "stale" };

export type PinState = CataloguePinState | StalePinState;

export interface CataloguePinStatus {
	readonly pin: PinEntry;
	readonly state: CataloguePinState;
}

export interface StalePinStatus {
	readonly id: PinId;
	readonly sha256: Sha256Hex;
	readonly bytes: number;
	readonly state: StalePinState;
}

export type PinStatus = CataloguePinStatus | StalePinStatus;

export type PinProgressListener = (fraction: number) => void;

export interface StorageUsage {
	readonly usedBytes: number;
	readonly quotaBytes: number | null;
}

export type PinStoreErrorCode = "network" | "corrupt" | "quota" | "missing";

export interface PinStoreError extends Error {
	readonly name: "PinStoreError";
	readonly code: PinStoreErrorCode;
	readonly pinId: PinId;
}

export interface PinStore {
	list(catalogue: readonly PinEntry[]): Promise<readonly PinStatus[]>;
	download(pin: PinEntry, onProgress?: PinProgressListener): Promise<void>;
	get(pin: PinEntry): Promise<Response>;
	delete(id: PinId): Promise<void>;
	usage(): Promise<StorageUsage>;
	requestPersistence(): Promise<boolean>;
}

export type GetDefaultPin = (catalogue: PinCatalogData) => PinEntry | null;

export type SetDefaultPin = (id: PinId) => void;
