import type { EngineStartOptions, UciSession } from "$lib/engine/types";
import { askToPersist } from "$lib/pins/persistence";
import type { PinCatalogData, PinEntry, PinId, PinProgressListener } from "$lib/pins/types";

export interface EngineSelection {
	readonly pinId: PinId | null;
	readonly hashMb: number;
	readonly threads: number;
}

export interface EngineConnectorDeps {
	catalogue(): Promise<PinCatalogData>;
	defaultPin(catalogue: PinCatalogData): PinEntry | null;
	download(pin: PinEntry, onProgress?: PinProgressListener): Promise<void>;
	ensure(pin: PinEntry, options: EngineStartOptions): Promise<UciSession>;
	effectiveHashMb(): number | null;
	requestPersistence(): Promise<boolean>;
}

export interface EngineReady {
	readonly pin: PinEntry;
	readonly effectiveHashMb: number | null;
	readonly threadsMax: number;
}

export interface EngineConnectorEvents {
	onCatalogue(pins: readonly PinEntry[]): void;
	onProgress(fraction: number | null): void;
	onReady(ready: EngineReady): void;
}

export class EngineConnectSupersededError extends Error {
	override readonly name = "EngineConnectSupersededError";

	constructor() {
		super("A newer engine connection replaced this one");
	}
}

export const startOptions = (selection: EngineSelection): EngineStartOptions =>
	selection.threads > 1
		? { hashMb: selection.hashMb, threads: selection.threads }
		: { hashMb: selection.hashMb };

export class EngineConnector {
	readonly #deps: EngineConnectorDeps;
	readonly #events: EngineConnectorEvents;
	#generation = 0;

	constructor(deps: EngineConnectorDeps, events: EngineConnectorEvents) {
		this.#deps = deps;
		this.#events = events;
	}

	cancel(): void {
		this.#generation += 1;
	}

	async connect(selection: EngineSelection): Promise<UciSession> {
		this.#generation += 1;
		const generation = this.#generation;
		const current = () => generation === this.#generation;
		const assertCurrent = () => {
			if (!current()) throw new EngineConnectSupersededError();
		};
		try {
			const catalogue = await this.#deps.catalogue();
			assertCurrent();
			this.#events.onCatalogue(catalogue.pins);
			const pin =
				catalogue.pins.find((entry) => entry.id === selection.pinId) ??
				this.#deps.defaultPin(catalogue);
			if (!pin) throw new Error("The engine catalogue lists no engine versions");
			this.#events.onProgress(0);
			await this.#deps.download(pin, (fraction) => {
				if (current()) this.#events.onProgress(fraction);
			});
			askToPersist(this.#deps);
			assertCurrent();
			this.#events.onProgress(null);
			const session = await this.#deps.ensure(pin, startOptions(selection));
			assertCurrent();
			this.#events.onReady({
				pin,
				effectiveHashMb: this.#deps.effectiveHashMb(),
				threadsMax: session.capabilities?.threadsMax ?? 1,
			});
			return session;
		} catch (error) {
			if (current()) this.#events.onProgress(null);
			throw error;
		}
	}
}
