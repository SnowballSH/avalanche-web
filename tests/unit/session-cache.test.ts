import { describe, expect, it } from "vitest";
import { WorkerEngineHost } from "../../src/lib/engine/host";
import { EngineSessionCache } from "../../src/lib/engine/session-cache";
import type { PinEntry } from "../../src/lib/pins/types";
import { fakeConnections } from "./helpers/fake-engine";

const pin: PinEntry = {
	id: "master-9b7ee6f",
	commit: "9b7ee6ff829dcfb5ee5e48d8dcb83bd44c26a642",
	label: "4.0.0+ (master, 2026-09-27)",
	date: "2026-09-27",
	sha256: "ab".repeat(32),
	bytes: 25_698_005,
};

describe("EngineSessionCache", () => {
	it("reuses the running session for the same pin and options", async () => {
		const fake = fakeConnections();
		const cache = new EngineSessionCache(new WorkerEngineHost(fake.connect));
		const first = await cache.ensure(pin, { hashMb: 64 });
		const second = await cache.ensure(pin, { hashMb: 64 });
		expect(second).toBe(first);
		expect(fake.engines).toHaveLength(1);
	});

	it("treats one thread and an unset Threads as the same options", async () => {
		const fake = fakeConnections();
		const cache = new EngineSessionCache(new WorkerEngineHost(fake.connect));
		const first = await cache.ensure(pin, { hashMb: 64 });
		expect(await cache.ensure(pin, { hashMb: 64, threads: 1 })).toBe(first);
		expect(fake.engines).toHaveLength(1);
	});

	it("starts a new worker when the Hash or the pin changes", async () => {
		const fake = fakeConnections();
		const cache = new EngineSessionCache(new WorkerEngineHost(fake.connect));
		const first = await cache.ensure(pin, { hashMb: 64 });
		const second = await cache.ensure(pin, { hashMb: 128 });
		expect(second).not.toBe(first);
		await cache.ensure({ ...pin, id: "master-910711f", sha256: "cd".repeat(32) }, { hashMb: 128 });
		expect(fake.engines).toHaveLength(3);
		expect(fake.engines[0]?.terminated).toBe(true);
		expect(fake.engines[1]?.terminated).toBe(true);
	});

	it("starts a new worker after a crash", async () => {
		const fake = fakeConnections();
		const cache = new EngineSessionCache(new WorkerEngineHost(fake.connect));
		const first = await cache.ensure(pin, { hashMb: 64 });
		fake.handlers[0]?.onFailure(new Error("trap"));
		const second = await cache.ensure(pin, { hashMb: 64 });
		expect(second).not.toBe(first);
		expect(fake.engines).toHaveLength(2);
	});

	it("retries a start that failed", async () => {
		let attempts = 0;
		const fake = fakeConnections({
			beforeConnect: async () => {
				attempts += 1;
				if (attempts === 1) throw new Error("load failed");
			},
		});
		const cache = new EngineSessionCache(new WorkerEngineHost(fake.connect));
		await expect(cache.ensure(pin, { hashMb: 64 })).rejects.toThrow("load failed");
		await expect(cache.ensure(pin, { hashMb: 64 })).resolves.toBeDefined();
	});
});
