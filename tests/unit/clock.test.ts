import { describe, expect, it } from "vitest";
import { createClock } from "../../src/lib/play/clock";

const fakeTime = (start = 1_000) => {
	let current = start;
	return {
		now: () => current,
		advance: (ms: number) => {
			current += ms;
		},
	};
};

describe("createClock", () => {
	it("charges the running side and applies the increment on press", () => {
		const time = fakeTime();
		const clock = createClock({ baseMs: 60_000, incrementMs: 2_000, now: time.now });
		clock.start("white");
		time.advance(5_000);
		expect(clock.press()).toBe(57_000);
		expect(clock.running).toBe("black");
		expect(clock.remaining("white", time.now())).toBe(57_000);
		time.advance(1_500);
		expect(clock.remaining("black", time.now())).toBe(58_500);
		expect(clock.press()).toBe(60_500);
		expect(clock.running).toBe("white");
	});

	it("charges a 30 s jump in the time source in full and flags on time", () => {
		const time = fakeTime();
		const clock = createClock({ baseMs: 20_000, incrementMs: 0, now: time.now });
		clock.start("white");
		time.advance(100);
		expect(clock.remaining("white", time.now())).toBe(19_900);
		time.advance(30_000);
		expect(clock.remaining("white", time.now())).toBe(0);
		expect(clock.remaining("black", time.now())).toBe(20_000);
		expect(clock.flagged(time.now())).toBe("white");
	});

	it("flags at the exact moment the running side's time runs out", () => {
		const time = fakeTime();
		const clock = createClock({ baseMs: 1_000, incrementMs: 0, now: time.now });
		clock.start("black");
		time.advance(999);
		expect(clock.flagged(time.now())).toBeNull();
		time.advance(1);
		expect(clock.flagged(time.now())).toBe("black");
	});

	it("stop charges up to the given moment and can never flag afterwards", () => {
		const time = fakeTime();
		const clock = createClock({ baseMs: 10_000, incrementMs: 0, now: time.now });
		clock.start("white");
		time.advance(4_000);
		clock.stop(time.now());
		expect(clock.running).toBeNull();
		time.advance(60_000);
		expect(clock.remaining("white", time.now())).toBe(6_000);
		expect(clock.flagged(time.now())).toBeNull();
	});

	it("start on a running clock charges the old side and switches without an increment", () => {
		const time = fakeTime();
		const clock = createClock({ baseMs: 10_000, incrementMs: 3_000, now: time.now });
		clock.start("black");
		time.advance(2_000);
		clock.start("white");
		expect(clock.remaining("black", time.now())).toBe(8_000);
		time.advance(1_000);
		expect(clock.remaining("white", time.now())).toBe(9_000);
	});

	it("snapshots and restores, charging the restored side from the moment of restore", () => {
		const time = fakeTime();
		const clock = createClock({ baseMs: 60_000, incrementMs: 0, now: time.now });
		clock.start("white");
		time.advance(10_000);
		const snapshot = clock.snapshot(time.now());
		expect(snapshot).toEqual({ whiteMs: 50_000, blackMs: 60_000, running: "white" });

		time.advance(3_600_000);
		const restored = createClock({
			baseMs: 60_000,
			incrementMs: 0,
			now: time.now,
			restore: snapshot,
		});
		expect(restored.running).toBe("white");
		expect(restored.remaining("white", time.now())).toBe(50_000);
		time.advance(1_000);
		expect(restored.remaining("white", time.now())).toBe(49_000);
	});

	it("refuses a press while stopped", () => {
		const clock = createClock({ baseMs: 1_000, incrementMs: 0, now: () => 0 });
		expect(() => clock.press()).toThrow();
	});
});
