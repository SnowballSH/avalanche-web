import type { PinEntry, PinId } from "$lib/pins/types";

export type UciMove = string;

export type Fen = string;

export type SearchId = number;

export type ScoreBound = "lower" | "upper";

export type Score =
	| { readonly kind: "cp"; readonly value: number; readonly bound?: ScoreBound }
	| { readonly kind: "mate"; readonly value: number; readonly bound?: ScoreBound };

export interface SearchInfo {
	readonly searchId: SearchId;
	readonly depth: number;
	readonly seldepth?: number;
	readonly multipv: number;
	readonly score: Score;
	readonly nodes?: number;
	readonly nps?: number;
	readonly timeMs?: number;
	readonly pv: readonly UciMove[];
}

export interface BestMove {
	readonly searchId: SearchId;
	readonly move: UciMove | null;
	readonly ponder?: UciMove;
}

export type UciOptionSpec =
	| { readonly kind: "spin"; readonly default: number; readonly min: number; readonly max: number }
	| { readonly kind: "check"; readonly default: boolean }
	| { readonly kind: "combo"; readonly default: string; readonly values: readonly string[] }
	| { readonly kind: "button" }
	| { readonly kind: "string"; readonly default: string };

export type UciOptionValue = number | boolean | string;

export interface EloRange {
	readonly min: number;
	readonly max: number;
	readonly default: number;
}

export interface EngineCapabilities {
	readonly options: ReadonlyMap<string, UciOptionSpec>;
	readonly threadsMax: number;
	readonly supportsLimitStrength: boolean;
	readonly eloRange: EloRange | null;
	readonly multiPvMax: number;
	readonly supportsChess960: boolean;
}

export interface InfiniteSearch {
	readonly infinite: true;
}

export interface BoundedSearch {
	readonly infinite?: false;
	readonly depth?: number;
	readonly nodes?: number;
	readonly movetime?: number;
	readonly wtime?: number;
	readonly btime?: number;
	readonly winc?: number;
	readonly binc?: number;
	readonly movestogo?: number;
}

export type SearchLimits = (InfiniteSearch | BoundedSearch) & { readonly ponder?: boolean };

export interface SearchAbortedError extends Error {
	readonly name: "SearchAbortedError";
	readonly searchId: SearchId;
	readonly reason: "terminated" | "crashed";
}

export interface SearchHandle {
	readonly searchId: SearchId;
	readonly info: AsyncIterable<SearchInfo>;
	readonly result: Promise<BestMove>;
	stop(): void;
	ponderhit(): void;
}

export interface UciSession {
	readonly capabilities: EngineCapabilities | null;
	handshake(): Promise<EngineCapabilities>;
	setOption(name: string, value?: UciOptionValue): Promise<void>;
	newGame(): Promise<void>;
	position(startFen: Fen, moves: readonly UciMove[]): Promise<void>;
	search(limits: SearchLimits): SearchHandle;
	isReady(): Promise<void>;
}

export interface EngineStartOptions {
	readonly hashMb: number;
	readonly threads?: number;
}

export type EngineNotice =
	| {
			readonly kind: "hash-allocation-failed";
			readonly requestedMb: number;
			readonly effectiveMb: number;
	  }
	| { readonly kind: "engine-error"; readonly message: string };

export interface EngineCrash {
	readonly pin: PinEntry;
	readonly error: Error;
	readonly searchId: SearchId | null;
}

export interface PinUnavailableError extends Error {
	readonly name: "PinUnavailableError";
	readonly pinId: PinId;
}

export type Unsubscribe = () => void;

export interface EngineHost {
	readonly pin: PinEntry | null;
	readonly effectiveHashMb: number | null;
	start(pin: PinEntry, options: EngineStartOptions): Promise<UciSession>;
	restart(options: EngineStartOptions): Promise<UciSession>;
	terminate(): Promise<void>;
	onCrash(listener: (crash: EngineCrash) => void): Unsubscribe;
	onNotice(listener: (notice: EngineNotice) => void): Unsubscribe;
}

export type LeaseOwner = "play" | "analysis";

export type LeaseState = "active" | "suspended" | "released";

export interface EngineLease {
	readonly owner: LeaseOwner;
	readonly state: LeaseState;
	onStateChange(listener: (state: LeaseState) => void): Unsubscribe;
}

export interface LeaseConflictError extends Error {
	readonly name: "LeaseConflictError";
	readonly owner: LeaseOwner;
}

export interface EngineScheduler {
	acquire(owner: LeaseOwner): EngineLease;
	release(lease: EngineLease): void;
}
