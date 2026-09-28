import type { Color } from "$lib/chess/types";
import type { Clock, ClockFactory, ClockOptions, ClockSnapshot, MonotonicNow } from "./types";

const other = (side: Color): Color => (side === "white" ? "black" : "white");

class MonotonicClock implements Clock {
	readonly #incrementMs: number;
	readonly #now: MonotonicNow;
	readonly #stored: Record<Color, number>;
	#running: Color | null;
	#since: number;

	constructor(options: ClockOptions) {
		this.#incrementMs = options.incrementMs;
		this.#now = options.now;
		const restore = options.restore;
		this.#stored = {
			white: restore?.whiteMs ?? options.baseMs,
			black: restore?.blackMs ?? options.baseMs,
		};
		this.#running = restore?.running ?? null;
		this.#since = this.#now();
	}

	get running(): Color | null {
		return this.#running;
	}

	start(side: Color): void {
		const now = this.#now();
		this.#charge(now);
		this.#running = side;
		this.#since = now;
	}

	press(): number {
		const presser = this.#running;
		if (presser === null) throw new Error("The clock is not running");
		const now = this.#now();
		this.#charge(now);
		this.#stored[presser] += this.#incrementMs;
		this.#running = other(presser);
		this.#since = now;
		return this.#stored[presser];
	}

	stop(now: number): void {
		this.#charge(now);
		this.#running = null;
		this.#since = now;
	}

	remaining(side: Color, now: number): number {
		const elapsed = side === this.#running ? Math.max(0, now - this.#since) : 0;
		return Math.max(0, this.#stored[side] - elapsed);
	}

	flagged(now: number): Color | null {
		const side = this.#running;
		return side !== null && this.remaining(side, now) <= 0 ? side : null;
	}

	snapshot(now: number): ClockSnapshot {
		return {
			whiteMs: this.remaining("white", now),
			blackMs: this.remaining("black", now),
			running: this.#running,
		};
	}

	#charge(now: number): void {
		const side = this.#running;
		if (side === null) return;
		this.#stored[side] = this.remaining(side, now);
	}
}

export const createClock: ClockFactory = (options) => new MonotonicClock(options);
