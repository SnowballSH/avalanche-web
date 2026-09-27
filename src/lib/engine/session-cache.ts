import type { PinEntry } from "$lib/pins/types";
import type { EngineHost, EngineStartOptions, UciSession } from "./types";

interface CachedSession {
	readonly key: string;
	readonly session: Promise<UciSession>;
}

const sessionKey = (pin: PinEntry, options: EngineStartOptions): string =>
	[pin.id, pin.sha256, options.hashMb, options.threads ?? ""].join("|");

export class EngineSessionCache {
	readonly #host: EngineHost;
	#current: CachedSession | null = null;

	constructor(host: EngineHost) {
		this.#host = host;
		host.onCrash(() => {
			this.#current = null;
		});
	}

	get host(): EngineHost {
		return this.#host;
	}

	ensure(pin: PinEntry, options: EngineStartOptions): Promise<UciSession> {
		const key = sessionKey(pin, options);
		if (this.#current?.key === key) return this.#current.session;
		const session = this.#host.start(pin, options);
		const cached = { key, session };
		this.#current = cached;
		session.catch(() => {
			if (this.#current === cached) this.#current = null;
		});
		return session;
	}
}
