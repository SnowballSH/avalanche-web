import type { DefaultPinChoice } from "./default-pin";
import { PinStoreError } from "./store";
import type {
	CataloguePinState,
	PinCatalogData,
	PinEntry,
	PinId,
	PinStatus,
	PinStore,
	Sha256Hex,
	StalePinState,
	StorageUsage,
} from "./types";

export type PinRow =
	| {
			readonly kind: "catalogue";
			readonly pin: PinEntry;
			readonly state: CataloguePinState;
			readonly error: string | null;
	  }
	| {
			readonly kind: "stale";
			readonly id: PinId;
			readonly sha256: Sha256Hex;
			readonly bytes: number;
			readonly state: StalePinState;
			readonly error: string | null;
	  };

export interface PinManagerState {
	readonly status: "loading" | "ready" | "failed";
	readonly message: string | null;
	readonly rows: readonly PinRow[];
	readonly usage: StorageUsage | null;
	readonly defaultId: PinId | null;
}

export interface PinManagerOptions {
	readonly store: PinStore;
	readonly catalogue: () => Promise<PinCatalogData>;
	readonly defaults: DefaultPinChoice;
}

interface DownloadProgress {
	fraction: number;
}

export type PinManagerListener = (state: PinManagerState) => void;

const messageOf = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

export const pinErrorMessage = (error: unknown): string => {
	if (!(error instanceof PinStoreError)) return messageOf(error);
	switch (error.code) {
		case "quota":
			return "The browser's storage is full. Delete engine versions you no longer need on this page, then download again.";
		case "network":
			return `The download failed (${error.message}). Try again.`;
		case "corrupt":
			return "The download did not match its checksum and was discarded. Try again.";
		case "missing":
			return "The engine version was deleted before its download finished.";
	}
};

export class PinManager {
	readonly #store: PinStore;
	readonly #loadCatalogue: () => Promise<PinCatalogData>;
	readonly #defaults: DefaultPinChoice;
	readonly #listeners = new Set<PinManagerListener>();
	readonly #downloads = new Map<PinId, DownloadProgress>();
	readonly #errors = new Map<PinId, string>();
	#catalogue: PinCatalogData | null = null;
	#statuses: readonly PinStatus[] = [];
	#refreshes = 0;
	#state: PinManagerState = {
		status: "loading",
		message: null,
		rows: [],
		usage: null,
		defaultId: null,
	};

	constructor(options: PinManagerOptions) {
		this.#store = options.store;
		this.#loadCatalogue = options.catalogue;
		this.#defaults = options.defaults;
	}

	get state(): PinManagerState {
		return this.#state;
	}

	subscribe(listener: PinManagerListener): () => void {
		this.#listeners.add(listener);
		listener(this.#state);
		return () => {
			this.#listeners.delete(listener);
		};
	}

	async load(): Promise<void> {
		try {
			this.#catalogue = await this.#loadCatalogue();
		} catch (error) {
			this.#fail(`The list of engine versions could not be loaded (${messageOf(error)}).`);
			return;
		}
		await this.refresh();
	}

	async refresh(): Promise<void> {
		const catalogue = this.#catalogue;
		if (!catalogue) return;
		const generation = ++this.#refreshes;
		let statuses: readonly PinStatus[];
		let usage: StorageUsage;
		try {
			[statuses, usage] = await Promise.all([
				this.#store.list(catalogue.pins),
				this.#store.usage(),
			]);
		} catch (error) {
			if (generation === this.#refreshes) {
				this.#fail(`The engines stored in this browser could not be read (${messageOf(error)}).`);
			}
			return;
		}
		if (generation !== this.#refreshes) return;
		this.#statuses = statuses;
		this.#state = { ...this.#state, status: "ready", message: null, usage };
		for (const status of statuses) {
			if ("pin" in status && status.state.kind === "downloading") {
				if (!this.#downloads.has(status.pin.id))
					void this.#follow(status.pin, status.state.fraction);
			}
		}
		this.#publish();
	}

	async download(id: PinId): Promise<void> {
		const pin = this.#catalogue?.pins.find((entry) => entry.id === id);
		if (!pin || this.#downloads.has(id)) return;
		await this.#follow(pin, 0);
	}

	async remove(id: PinId): Promise<void> {
		this.#downloads.delete(id);
		this.#errors.delete(id);
		try {
			await this.#store.delete(id);
		} catch (error) {
			this.#errors.set(id, messageOf(error));
		}
		await this.refresh();
	}

	setDefault(id: PinId): void {
		this.#defaults.setDefaultPin(id);
		this.#publish();
	}

	async #follow(pin: PinEntry, fraction: number): Promise<void> {
		const { id } = pin;
		const progress: DownloadProgress = { fraction };
		const isCurrent = () => this.#downloads.get(id) === progress;
		this.#errors.delete(id);
		this.#downloads.set(id, progress);
		this.#publish();
		try {
			await this.#store.download(pin, (next) => {
				if (!isCurrent()) return;
				progress.fraction = next;
				this.#publish();
			});
		} catch (error) {
			if (isCurrent()) this.#errors.set(id, pinErrorMessage(error));
		}
		if (!isCurrent()) return;
		this.#downloads.delete(id);
		await this.refresh();
	}

	#rows(): readonly PinRow[] {
		return this.#statuses.map((status): PinRow => {
			if (!("pin" in status)) {
				return { kind: "stale", ...status, error: this.#errors.get(status.id) ?? null };
			}
			const progress = this.#downloads.get(status.pin.id);
			return {
				kind: "catalogue",
				pin: status.pin,
				state: progress ? { kind: "downloading", fraction: progress.fraction } : status.state,
				error: this.#errors.get(status.pin.id) ?? null,
			};
		});
	}

	#fail(message: string): void {
		this.#state = { ...this.#state, status: "failed", message };
		this.#publish();
	}

	#publish(): void {
		const catalogue = this.#catalogue;
		this.#state = {
			...this.#state,
			rows: this.#rows(),
			defaultId: catalogue ? (this.#defaults.getDefaultPin(catalogue)?.id ?? null) : null,
		};
		for (const listener of this.#listeners) listener(this.#state);
	}
}
