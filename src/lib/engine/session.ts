import { deriveCapabilities, parseOptionLine } from "./capabilities";
import type {
	BestMove,
	EngineCapabilities,
	Fen,
	SearchAbortedError as SearchAbortedErrorContract,
	SearchHandle,
	SearchId,
	SearchInfo,
	SearchLimits,
	UciMove,
	UciOptionSpec,
	UciOptionValue,
	UciSession,
} from "./types";
import { parseBestMove, parseInfoLine } from "./uci-parse";

export interface LineTransport {
	send(command: string): void;
}

export type AbortReason = SearchAbortedErrorContract["reason"];

export class SearchAbortedError extends Error implements SearchAbortedErrorContract {
	override readonly name = "SearchAbortedError";
	readonly searchId: SearchId;
	readonly reason: AbortReason;

	constructor(searchId: SearchId, reason: AbortReason) {
		super(`Search ${String(searchId)} was aborted: engine ${reason}`);
		this.searchId = searchId;
		this.reason = reason;
	}
}

class AsyncQueue<T> implements AsyncIterable<T> {
	readonly #buffered: T[] = [];
	#waiting: ((result: IteratorResult<T>) => void) | null = null;
	#closed = false;
	#consumed = false;

	push(value: T): void {
		if (this.#closed) return;
		if (this.#waiting) {
			const resolve = this.#waiting;
			this.#waiting = null;
			resolve({ value, done: false });
			return;
		}
		this.#buffered.push(value);
	}

	close(): void {
		if (this.#closed) return;
		this.#closed = true;
		const resolve = this.#waiting;
		this.#waiting = null;
		resolve?.({ value: undefined, done: true });
	}

	#next(): Promise<IteratorResult<T>> {
		const buffered = this.#buffered.shift();
		if (buffered !== undefined) return Promise.resolve({ value: buffered, done: false });
		if (this.#closed) return Promise.resolve({ value: undefined, done: true });
		return new Promise((resolve) => {
			this.#waiting = resolve;
		});
	}

	#return(): Promise<IteratorResult<T>> {
		this.#buffered.length = 0;
		this.close();
		return Promise.resolve({ value: undefined, done: true });
	}

	[Symbol.asyncIterator](): AsyncIterator<T> {
		if (this.#consumed) throw new Error("The info stream has a single consumer");
		this.#consumed = true;
		return { next: () => this.#next(), return: () => this.#return() };
	}
}

class Search {
	readonly searchId: SearchId;
	readonly infos = new AsyncQueue<SearchInfo>();
	readonly #result = Promise.withResolvers<BestMove>();
	stopRequested = false;
	superseded = false;

	constructor(searchId: SearchId) {
		this.searchId = searchId;
		this.#result.promise.catch(() => undefined);
	}

	get result(): Promise<BestMove> {
		return this.#result.promise;
	}

	finish(bestMove: BestMove): void {
		this.infos.close();
		this.#result.resolve(bestMove);
	}

	abort(reason: AbortReason): void {
		this.infos.close();
		this.#result.reject(new SearchAbortedError(this.searchId, reason));
	}
}

const BOUNDED_LIMIT_TOKENS = [
	"depth",
	"nodes",
	"movetime",
	"wtime",
	"btime",
	"winc",
	"binc",
	"movestogo",
] as const;

function goCommand(limits: SearchLimits): string {
	const tokens = ["go"];
	if (limits.ponder) tokens.push("ponder");
	if (limits.infinite !== true) {
		for (const name of BOUNDED_LIMIT_TOKENS) {
			const value = limits[name];
			if (value !== undefined) tokens.push(name, String(value));
		}
	}
	if (tokens.length === (limits.ponder ? 2 : 1)) tokens.push("infinite");
	return tokens.join(" ");
}

function findOption(
	options: ReadonlyMap<string, UciOptionSpec>,
	name: string,
): [string, UciOptionSpec] | undefined {
	const wanted = name.toLowerCase();
	for (const entry of options) if (entry[0].toLowerCase() === wanted) return entry;
	return undefined;
}

function validatedOptionValue(
	name: string,
	spec: UciOptionSpec,
	value: UciOptionValue | undefined,
): string | undefined {
	switch (spec.kind) {
		case "spin":
			if (typeof value !== "number" || !Number.isInteger(value))
				throw new RangeError(`Option ${name} takes an integer`);
			if (value < spec.min || value > spec.max)
				throw new RangeError(
					`Option ${name} must be between ${String(spec.min)} and ${String(spec.max)}`,
				);
			return String(value);
		case "check":
			if (typeof value !== "boolean") throw new RangeError(`Option ${name} takes a boolean`);
			return String(value);
		case "combo": {
			const wanted = typeof value === "string" ? value.toLowerCase() : undefined;
			const chosen = spec.values.find((candidate) => candidate.toLowerCase() === wanted);
			if (chosen === undefined) throw new RangeError(`Option ${name} takes one of its values`);
			return chosen;
		}
		case "button":
			if (value !== undefined) throw new RangeError(`Option ${name} takes no value`);
			return undefined;
		case "string":
			if (typeof value !== "string") throw new RangeError(`Option ${name} takes a string`);
			return value;
	}
}

interface PendingHandshake {
	readonly options: Map<string, UciOptionSpec>;
	readonly resolvers: PromiseWithResolvers<EngineCapabilities>;
}

export class UciSessionRuntime implements UciSession {
	readonly #transport: LineTransport;
	#capabilities: EngineCapabilities | null = null;
	#handshakePromise: Promise<EngineCapabilities> | null = null;
	#pendingHandshake: PendingHandshake | null = null;
	readonly #readyWaiters: PromiseWithResolvers<void>[] = [];
	readonly #searches: Search[] = [];
	#nextSearchId: SearchId = 1;
	#aborted: AbortReason | null = null;

	constructor(transport: LineTransport) {
		this.#transport = transport;
	}

	get capabilities(): EngineCapabilities | null {
		return this.#capabilities;
	}

	get runningSearchId(): SearchId | null {
		return this.#searches[0]?.searchId ?? null;
	}

	handshake(): Promise<EngineCapabilities> {
		if (this.#handshakePromise) return this.#handshakePromise;
		this.#assertLive();
		const resolvers = Promise.withResolvers<EngineCapabilities>();
		this.#pendingHandshake = { options: new Map(), resolvers };
		this.#handshakePromise = resolvers.promise;
		this.#transport.send("uci");
		return resolvers.promise;
	}

	async setOption(name: string, value?: UciOptionValue): Promise<void> {
		if (!this.#capabilities) throw new Error("setOption requires a completed handshake");
		const found = findOption(this.#capabilities.options, name);
		if (!found) throw new RangeError(`Unknown engine option ${name}`);
		const [canonicalName, spec] = found;
		const encoded = validatedOptionValue(canonicalName, spec, value);
		this.#assertLive();
		this.#supersedeRunningSearch();
		this.#transport.send(
			encoded === undefined
				? `setoption name ${canonicalName}`
				: `setoption name ${canonicalName} value ${encoded}`,
		);
		await this.isReady();
	}

	async newGame(): Promise<void> {
		this.#assertLive();
		this.#supersedeRunningSearch();
		this.#transport.send("ucinewgame");
		await this.isReady();
	}

	async position(startFen: Fen, moves: readonly UciMove[]): Promise<void> {
		this.#assertLive();
		this.#supersedeRunningSearch();
		const suffix = moves.length > 0 ? ` moves ${moves.join(" ")}` : "";
		this.#transport.send(`position fen ${startFen}${suffix}`);
		await this.isReady();
	}

	search(limits: SearchLimits): SearchHandle {
		this.#assertLive();
		this.#stopRunningSearch();
		const search = new Search(this.#nextSearchId++);
		this.#searches.push(search);
		this.#transport.send(goCommand(limits));
		return {
			searchId: search.searchId,
			info: search.infos,
			result: search.result,
			stop: () => this.#stop(search),
			ponderhit: () => this.#ponderhit(search),
		};
	}

	isReady(): Promise<void> {
		if (this.#aborted) return Promise.reject(this.#abortedError(this.#aborted));
		const waiter = Promise.withResolvers<void>();
		this.#readyWaiters.push(waiter);
		this.#transport.send("isready");
		return waiter.promise;
	}

	receive(line: string): void {
		if (this.#pendingHandshake && this.#receiveHandshakeLine(line, this.#pendingHandshake)) return;
		if (line === "readyok") {
			this.#readyWaiters.shift()?.resolve();
			return;
		}
		const running = this.#searches[0];
		if (!running) return;
		const bestMove = parseBestMove(line, running.searchId);
		if (bestMove) {
			this.#searches.shift();
			running.finish(bestMove);
			return;
		}
		if (running.superseded) return;
		const info = parseInfoLine(line, running.searchId);
		if (info) running.infos.push(info);
	}

	abort(reason: AbortReason): void {
		if (this.#aborted) return;
		this.#aborted = reason;
		const abortedError = this.#abortedError(reason);
		this.#pendingHandshake?.resolvers.reject(abortedError);
		this.#pendingHandshake = null;
		for (const waiter of this.#readyWaiters.splice(0)) waiter.reject(abortedError);
		for (const search of this.#searches.splice(0)) search.abort(reason);
	}

	#receiveHandshakeLine(line: string, handshake: PendingHandshake): boolean {
		if (line === "uciok") {
			this.#capabilities = deriveCapabilities(handshake.options);
			this.#pendingHandshake = null;
			handshake.resolvers.resolve(this.#capabilities);
			return true;
		}
		const option = parseOptionLine(line);
		if (option) handshake.options.set(option.name, option.spec);
		return option !== undefined;
	}

	#abortedError(reason: AbortReason): Error {
		return new Error(`Engine ${reason}: session aborted`);
	}

	#assertLive(): void {
		if (this.#aborted) throw this.#abortedError(this.#aborted);
	}

	#stop(search: Search): void {
		if (search.stopRequested || this.#aborted || !this.#searches.includes(search)) return;
		search.stopRequested = true;
		this.#transport.send("stop");
	}

	#ponderhit(search: Search): void {
		if (search.stopRequested || this.#aborted || !this.#searches.includes(search)) return;
		this.#transport.send("ponderhit");
	}

	#stopRunningSearch(): void {
		const latest = this.#searches.at(-1);
		if (latest) this.#stop(latest);
	}

	#supersedeRunningSearch(): void {
		for (const search of this.#searches) {
			search.superseded = true;
			search.infos.close();
		}
		this.#stopRunningSearch();
	}
}
