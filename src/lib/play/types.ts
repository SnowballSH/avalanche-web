import type { Color, GameResult, StartPosition } from "$lib/chess/types";
import type { Score, UciMove } from "$lib/engine/types";
import type { PinId } from "$lib/pins/types";

export type MonotonicNow = () => number;

export interface TimeControl {
	readonly baseMs: number;
	readonly incrementMs: number;
}

export interface ClockSnapshot {
	readonly whiteMs: number;
	readonly blackMs: number;
	readonly running: Color | null;
}

export interface ClockOptions extends TimeControl {
	readonly now: MonotonicNow;
	readonly restore?: ClockSnapshot;
}

export interface Clock {
	readonly running: Color | null;
	start(side: Color): void;
	press(): number;
	stop(now: number): void;
	remaining(side: Color, now: number): number;
	flagged(now: number): Color | null;
	snapshot(now: number): ClockSnapshot;
}

export type ClockFactory = (options: ClockOptions) => Clock;

export type SideChoice = Color | "random";

export type Strength = { readonly kind: "full" } | { readonly kind: "elo"; readonly elo: number };

export type EngineLimitKind = "movetime" | "depth" | "nodes";

export interface EngineLimit {
	readonly kind: EngineLimitKind;
	readonly value: number;
}

export interface PlaySettings {
	readonly side: SideChoice;
	readonly start: StartPosition;
	readonly pinId: PinId;
	readonly strength: Strength;
	readonly timeControl: TimeControl;
	readonly engineLimit: EngineLimit | null;
	readonly hashMb: number;
	readonly threads: number | null;
	readonly ponder: boolean;
}

export interface GameSetup {
	readonly settings: PlaySettings;
	readonly userColor: Color;
	readonly startedAt: string;
}

export interface SavedGame {
	readonly version: 1;
	readonly setup: GameSetup;
	readonly moves: readonly UciMove[];
	readonly clock: ClockSnapshot;
	readonly engineScores: readonly Score[];
	readonly result: GameResult | null;
}

export interface PlayStore {
	load(): SavedGame | null;
	save(game: SavedGame): void;
	clear(): void;
}
