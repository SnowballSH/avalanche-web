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
		await this.terminate();
		this.#pin = pin;
		const running = await this.#open(pin);
		this.#running = running;
		const { session } = running;
		await session.handshake();
		this.#effectiveHashMb = options.hashMb;
		await session.setOption("Hash", options.hashMb);
		if (options.threads !== undefined) await session.setOption("Threads", options.threads);
		return session;
	}

	restart(options: EngineStartOptions): Promise<UciSession> {
		const pin = this.#pin;
		if (!pin) return Promise.reject(new Error("No pin to restart: start() has not run"));
		return this.start(pin, options);
	}

	terminate(): Promise<void> {
		const running = this.#running;
		this.#running = null;
		this.#pin = null;
		this.#effectiveHashMb = null;
		if (running) {
			running.session.abort("terminated");
			running.connection.terminate();
		}
		return Promise.resolve();
	}

	onCrash(listener: (crash: EngineCrash) => void): Unsubscribe {
		return this.#crashListeners.add(listener);
	}

	onNotice(listener: (notice: EngineNotice) => void): Unsubscribe {
		return this.#noticeListeners.add(listener);
	}

	async #open(pin: PinEntry): Promise<RunningEngine> {
		let running: RunningEngine | null = null;
		const handlers: EngineConnectionHandlers = {
			onLine: (line) => {
				running?.session.receive(line);
				this.#receiveNotice(line);
			},
			onFailure: (error) => {
				if (running) this.#crash(running, error);
			},
		};
		let connection: EngineConnection;
		try {
			connection = await this.#connect(pin, handlers);
		} catch (error) {
			this.#pin = null;
			throw (error instanceof Error && PinUnavailableError.fromMessage(error.message)) || error;
		}
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
		if (this.#running !== running) return;
		const searchId = running.session.runningSearchId;
		this.#running = null;
		this.#effectiveHashMb = null;
		running.session.abort("crashed");
		running.connection.terminate();
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
