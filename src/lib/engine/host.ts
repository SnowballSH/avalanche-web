import { pinCacheKey } from "$lib/pins/cache-key";
import type { PinEntry } from "$lib/pins/types";
import { AvalancheClient, webWorkerPort } from "../../../vendor/avalanche-web-abi1/src/client.ts";
import { PinUnavailableError } from "./pin-loader";
import { UciSessionRuntime } from "./session";
import type {
	EngineCrash,
	EngineHost,
	EngineNotice,
	EngineStartOptions,
	UciSession,
	Unsubscribe,
} from "./types";
import { parseEngineNotice } from "./uci-parse";

export interface EngineConnectionHandlers {
	readonly onLine: (line: string) => void;
	readonly onFailure: (error: Error) => void;
}

export interface EngineConnection {
	send(command: string): void;
	terminate(): void;
}

export type EngineConnectionFactory = (
	pin: PinEntry,
	handlers: EngineConnectionHandlers,
) => Promise<EngineConnection>;

export class EngineStartSupersededError extends Error {
	override readonly name = "EngineStartSupersededError";
	readonly pin: PinEntry;

	constructor(pin: PinEntry) {
		super(`Starting ${pin.id} was superseded by a later start or terminate`);
		this.pin = pin;
	}
}

interface RunningEngine {
	readonly pin: PinEntry;
	readonly connection: EngineConnection;
	readonly session: UciSessionRuntime;
}

class Listeners<T> {
	readonly #listeners = new Set<(value: T) => void>();

	add(listener: (value: T) => void): Unsubscribe {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}

	emit(value: T): void {
		for (const listener of this.#listeners) listener(value);
	}
}

export class WorkerEngineHost implements EngineHost {
	readonly #connect: EngineConnectionFactory;
	readonly #crashListeners = new Listeners<EngineCrash>();
	readonly #noticeListeners = new Listeners<EngineNotice>();
	#running: RunningEngine | null = null;
	#generation = 0;
	#pin: PinEntry | null = null;
	#effectiveHashMb: number | null = null;

	constructor(connect: EngineConnectionFactory) {
		this.#connect = connect;
	}

	get pin(): PinEntry | null {
		return this.#pin;
	}

	get effectiveHashMb(): number | null {
		return this.#effectiveHashMb;
	}

	async start(pin: PinEntry, options: EngineStartOptions): Promise<UciSession> {
		this.#shutdown();
		const generation = this.#generation;
		this.#pin = pin;
		let running: RunningEngine;
		try {
			running = await this.#open(pin);
		} catch (error) {
			if (generation !== this.#generation) throw new EngineStartSupersededError(pin);
			this.#pin = null;
			throw (error instanceof Error && PinUnavailableError.fromMessage(error.message)) || error;
		}
		if (generation !== this.#generation) {
			this.#retire(running, "terminated");
			throw new EngineStartSupersededError(pin);
		}
		this.#running = running;
		try {
			await this.#configure(running.session, options);
			return running.session;
		} catch (error) {
			if (generation !== this.#generation) throw new EngineStartSupersededError(pin);
			if (this.#running === running) {
				this.#running = null;
				this.#pin = null;
				this.#effectiveHashMb = null;
				this.#retire(running, "terminated");
			}
			throw error;
		}
	}

	restart(options: EngineStartOptions): Promise<UciSession> {
		const pin = this.#pin;
		if (!pin) return Promise.reject(new Error("No pin to restart: start() has not run"));
		return this.start(pin, options);
	}

	terminate(): Promise<void> {
		this.#shutdown();
		return Promise.resolve();
	}

	onCrash(listener: (crash: EngineCrash) => void): Unsubscribe {
		return this.#crashListeners.add(listener);
	}

	onNotice(listener: (notice: EngineNotice) => void): Unsubscribe {
		return this.#noticeListeners.add(listener);
	}

	#shutdown(): void {
		this.#generation++;
		const running = this.#running;
		this.#running = null;
		this.#pin = null;
		this.#effectiveHashMb = null;
		if (running) this.#retire(running, "terminated");
	}

	#retire(running: RunningEngine, reason: "terminated" | "crashed"): void {
		running.session.abort(reason);
		running.connection.terminate();
	}

	async #configure(session: UciSessionRuntime, options: EngineStartOptions): Promise<void> {
		const capabilities = await session.handshake();
		if (options.threads !== undefined && options.threads > capabilities.threadsMax) {
			throw new RangeError(
				`Threads ${String(options.threads)} exceeds the pin's maximum of ${String(capabilities.threadsMax)}`,
			);
		}
		this.#effectiveHashMb = options.hashMb;
		await session.setOption("Hash", options.hashMb);
		if (options.threads !== undefined) await session.setOption("Threads", options.threads);
	}

	async #open(pin: PinEntry): Promise<RunningEngine> {
		let running: RunningEngine | null = null;
		const handlers: EngineConnectionHandlers = {
			onLine: (line) => {
				if (!running || this.#running !== running) return;
				running.session.receive(line);
				this.#receiveNotice(line);
			},
			onFailure: (error) => {
				if (running && this.#running === running) this.#crash(running, error);
			},
		};
		const connection = await this.#connect(pin, handlers);
		running = { pin, connection, session: new UciSessionRuntime(connection) };
		return running;
	}

	#receiveNotice(line: string): void {
		const notice = parseEngineNotice(line);
		if (!notice) return;
		if (notice.kind === "hash-allocation-failed") this.#effectiveHashMb = notice.effectiveMb;
		this.#noticeListeners.emit(notice);
	}

	#crash(running: RunningEngine, error: Error): void {
		const searchId = running.session.runningSearchId;
		this.#running = null;
		this.#effectiveHashMb = null;
		this.#retire(running, "crashed");
		this.#crashListeners.emit({ pin: running.pin, error, searchId });
	}
}

const connectBrowserWorker: EngineConnectionFactory = async (pin, handlers) => {
	const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
	const client = await AvalancheClient.start(webWorkerPort(worker), pinCacheKey(pin), {
		onLine: handlers.onLine,
		onError: handlers.onFailure,
	});
	return {
		send: (command) => {
			if (!client.closed) client.send(command);
		},
		terminate: () => client.terminate(),
	};
};

export function createBrowserEngineHost(): EngineHost {
	return new WorkerEngineHost(connectBrowserWorker);
}
