import type { Color } from "$lib/chess/types";

export type MonotonicNow = () => number;

export interface TimeControl {
	readonly baseMs: number;
	readonly incrementMs: number;
}

export interface ClockOptions extends TimeControl {
	readonly now: MonotonicNow;
}

export interface Clock {
	readonly running: Color | null;
	start(side: Color): void;
	press(): number;
	remaining(side: Color, now: number): number;
	flagged(now: number): Color | null;
}

export type ClockFactory = (options: ClockOptions) => Clock;
