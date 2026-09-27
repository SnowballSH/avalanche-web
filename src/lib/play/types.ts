import type { Color } from "$lib/chess/types";

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
