import { describe, expect, it } from "vitest";
import { createScheduler, LeaseConflictError } from "../../src/lib/engine/scheduler";
import type { LeaseState } from "../../src/lib/engine/types";

describe("EngineScheduler", () => {
	it("hands out an active lease to the first owner", () => {
		const scheduler = createScheduler();
		const analysis = scheduler.acquire("analysis");
		expect(analysis.owner).toBe("analysis");
		expect(analysis.state).toBe("active");
	});

	it("suspends analysis while play holds a lease and resumes it on release", () => {
		const scheduler = createScheduler();
		const analysis = scheduler.acquire("analysis");
		const states: LeaseState[] = [];
		analysis.onStateChange((state) => states.push(state));

		const play = scheduler.acquire("play");
		expect(play.state).toBe("active");
		expect(analysis.state).toBe("suspended");

		scheduler.release(play);
		expect(play.state).toBe("released");
		expect(analysis.state).toBe("active");
		expect(states).toEqual(["suspended", "active"]);
	});

	it("starts analysis suspended when play is already active", () => {
		const scheduler = createScheduler();
		const play = scheduler.acquire("play");
		const analysis = scheduler.acquire("analysis");
		expect(analysis.state).toBe("suspended");
		scheduler.release(play);
		expect(analysis.state).toBe("active");
	});

	it("refuses a second lease for an owner that still holds one", () => {
		const scheduler = createScheduler();
		scheduler.acquire("analysis");
		expect(() => scheduler.acquire("analysis")).toThrow(LeaseConflictError);
		scheduler.acquire("play");
		expect(() => scheduler.acquire("analysis")).toThrow(LeaseConflictError);
		expect(() => scheduler.acquire("play")).toThrowError(
			expect.objectContaining({ name: "LeaseConflictError", owner: "play" }),
		);
	});

	it("lets an owner acquire again after releasing", () => {
		const scheduler = createScheduler();
		const first = scheduler.acquire("analysis");
		scheduler.release(first);
		expect(scheduler.acquire("analysis").state).toBe("active");
	});

	it("ignores a second release", () => {
		const scheduler = createScheduler();
		const analysis = scheduler.acquire("analysis");
		const play = scheduler.acquire("play");
		const states: LeaseState[] = [];
		analysis.onStateChange((state) => states.push(state));
		scheduler.release(play);
		scheduler.release(play);
		expect(states).toEqual(["active"]);
	});

	it("does not resume a released analysis lease when play ends", () => {
		const scheduler = createScheduler();
		const analysis = scheduler.acquire("analysis");
		const play = scheduler.acquire("play");
		scheduler.release(analysis);
		scheduler.release(play);
		expect(analysis.state).toBe("released");
	});

	it("stops notifying an unsubscribed listener", () => {
		const scheduler = createScheduler();
		const analysis = scheduler.acquire("analysis");
		const states: LeaseState[] = [];
		const unsubscribe = analysis.onStateChange((state) => states.push(state));
		unsubscribe();
		scheduler.acquire("play");
		expect(states).toEqual([]);
	});
});
