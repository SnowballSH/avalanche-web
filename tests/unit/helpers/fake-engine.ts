import type {
	EngineConnection,
	EngineConnectionFactory,
	EngineConnectionHandlers,
} from "../../../src/lib/engine/host";
import type { LineTransport } from "../../../src/lib/engine/session";

export const FAKE_OPTION_LINES: readonly string[] = [
	"option name Hash type spin default 16 min 1 max 1048576",
	"option name Threads type spin default 1 min 1 max 1",
	"option name MultiPV type spin default 1 min 1 max 256",
	"option name Ponder type check default false",
	"option name Clear Hash type button",
	"option name UCI_Chess960 type check default false",
	"option name UCI_LimitStrength type check default false",
	"option name UCI_Elo type spin default 3000 min 1320 max 3000",
];

export interface FakeEngineOptions {
	readonly onSetOption?: (name: string, value: string | undefined) => readonly string[];
}

export class FakeEngine implements LineTransport, EngineConnection {
	readonly commands: string[] = [];
	readonly #listeners: Array<(line: string) => void> = [];
	readonly #options: FakeEngineOptions;
	terminated = false;

	constructor(options: FakeEngineOptions = {}) {
		this.#options = options;
	}

	onLine(listener: (line: string) => void): void {
		this.#listeners.push(listener);
	}

	emit(...lines: readonly string[]): void {
		for (const line of lines) for (const listener of this.#listeners) listener(line);
	}

	send(command: string): void {
		this.commands.push(command);
		const [verb, ...rest] = command.split(" ");
		switch (verb) {
			case "uci":
				this.emit("id name Fake", "", ...FAKE_OPTION_LINES, "uciok");
				return;
			case "isready":
				this.emit("readyok");
				return;
			case "setoption": {
				const text = rest.join(" ");
				const split = text.indexOf(" value ");
				const name = split === -1 ? text.slice("name ".length) : text.slice("name ".length, split);
				const value = split === -1 ? undefined : text.slice(split + " value ".length);
				this.emit(...(this.#options.onSetOption?.(name, value) ?? []));
				return;
			}
			default:
				return;
		}
	}

	terminate(): void {
		this.terminated = true;
	}

	commandsMatching(prefix: string): string[] {
		return this.commands.filter((command) => command.startsWith(prefix));
	}
}

export interface FakeConnections {
	readonly engines: FakeEngine[];
	readonly handlers: EngineConnectionHandlers[];
	readonly connect: EngineConnectionFactory;
}

export function fakeConnections(options: FakeEngineOptions = {}): FakeConnections {
	const engines: FakeEngine[] = [];
	const handlers: EngineConnectionHandlers[] = [];
	return {
		engines,
		handlers,
		connect: (_pin, connectionHandlers) => {
			const engine = new FakeEngine(options);
			engine.onLine(connectionHandlers.onLine);
			engines.push(engine);
			handlers.push(connectionHandlers);
			return Promise.resolve(engine);
		},
	};
}
