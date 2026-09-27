import { describe, expect, it } from "vitest";
import { WorkerEngineHost } from "../../src/lib/engine/host";
import { PinUnavailableError } from "../../src/lib/engine/pin-loader";
import type { EngineCrash, EngineNotice } from "../../src/lib/engine/types";
import type { PinEntry } from "../../src/lib/pins/types";
import { fakeConnections } from "./helpers/fake-engine";

const pinA: PinEntry = {
	id: "master-8c66796",
	commit: "8c66796067c944c0188c62ee9254b8f421ffd19e",
	label: "4.0.0+ (master, 2026-09-27)",
	date: "2026-09-27",
	sha256: "ab".repeat(32),
	bytes: 50_897_196,
};

const pinB: PinEntry = {
	...pinA,
	id: "master-910711f",
	commit: "910711f",
	sha256: "cd".repeat(32),
};

const HASH_FAILED = "info string Hash: failed to allocate 1024 MB, still using 16 MB";

describe("WorkerEngineHost start", () => {
	it("resolves after the handshake and Hash have been applied", async () => {
		const fake = fakeConnections();
		const host = new WorkerEngineHost(fake.connect);
		const session = await host.start(pinA, { hashMb: 64 });
		expect(session.capabilities?.multiPvMax).toBe(256);
		expect(fake.engines[0]?.commands).toEqual(["uci", "setoption name Hash value 64", "isready"]);
		expect(host.pin).toBe(pinA);
		expect(host.effectiveHashMb).toBe(64);
	});

	it("applies Threads when given", async () => {
		const fake = fakeConnections();
		const host = new WorkerEngineHost(fake.connect);
		await host.start(pinA, { hashMb: 32, threads: 1 });
		expect(fake.engines[0]?.commandsMatching("setoption")).toEqual([
			"setoption name Hash value 32",
			"setoption name Threads value 1",
		]);
	});

	it("rejects with a PinUnavailableError when the worker reports the pin missing", async () => {
		const host = new WorkerEngineHost(() =>
			Promise.reject(new Error(new PinUnavailableError(pinA.id).message)),
		);
		await expect(host.start(pinA, { hashMb: 16 })).rejects.toThrowError(
			expect.objectContaining({ name: "PinUnavailableError", pinId: pinA.id }),
		);
		expect(host.pin).toBeNull();
	});

	it("passes other load failures through", async () => {
		const host = new WorkerEngineHost(() => Promise.reject(new Error("worker failed to load")));
		await expect(host.start(pinA, { hashMb: 16 })).rejects.toThrow("worker failed to load");
	});
});

describe("WorkerEngineHost restarts", () => {
	it("terminates the worker and starts a new one on a Hash change", async () => {
		const fake = fakeConnections();
		const host = new WorkerEngineHost(fake.connect);
		const first = await host.start(pinA, { hashMb: 64 });
		const search = first.search({ infinite: true });
		const second = await host.restart({ hashMb: 128 });
		expect(fake.engines).toHaveLength(2);
		expect(fake.engines[0]?.terminated).toBe(true);
		expect(fake.engines[1]?.terminated).toBe(false);
		expect(fake.engines[1]?.commandsMatching("setoption")).toEqual([
			"setoption name Hash value 128",
		]);
		expect(second).not.toBe(first);
		expect(host.effectiveHashMb).toBe(128);
		expect(host.pin).toBe(pinA);
		await expect(search.result).rejects.toMatchObject({
			name: "SearchAbortedError",
			reason: "terminated",
		});
	});

	it("terminates the worker and starts a new one on a pin change", async () => {
		const fake = fakeConnections();
		const host = new WorkerEngineHost(fake.connect);
		await host.start(pinA, { hashMb: 64 });
		await host.start(pinB, { hashMb: 64 });
		expect(fake.engines).toHaveLength(2);
		expect(fake.engines[0]?.terminated).toBe(true);
		expect(host.pin).toBe(pinB);
	});

	it("refuses to restart before any start", async () => {
		const host = new WorkerEngineHost(fakeConnections().connect);
		await expect(host.restart({ hashMb: 16 })).rejects.toThrow(/no pin/i);
	});

	it("clears the pin and hash on terminate", async () => {
		const fake = fakeConnections();
		const host = new WorkerEngineHost(fake.connect);
		await host.start(pinA, { hashMb: 64 });
		await host.terminate();
		expect(fake.engines[0]?.terminated).toBe(true);
		expect(host.pin).toBeNull();
		expect(host.effectiveHashMb).toBeNull();
		await host.terminate();
	});
});

describe("WorkerEngineHost crashes", () => {
	it("reports a worker failure through onCrash with the running search", async () => {
		const fake = fakeConnections();
		const host = new WorkerEngineHost(fake.connect);
		const crashes: EngineCrash[] = [];
		host.onCrash((crash) => crashes.push(crash));
		const session = await host.start(pinA, { hashMb: 64 });
		const search = session.search({ depth: 20 });
		const trap = new Error("RuntimeError: unreachable");
		fake.handlers[0]?.onFailure(trap);

		expect(crashes).toEqual([{ pin: pinA, error: trap, searchId: search.searchId }]);
		await expect(search.result).rejects.toMatchObject({ reason: "crashed" });
		expect(fake.engines[0]?.terminated).toBe(true);
		expect(host.effectiveHashMb).toBeNull();
		expect(host.pin).toBe(pinA);

		const restarted = await host.restart({ hashMb: 64 });
		expect(restarted.capabilities).not.toBeNull();
		expect(fake.engines).toHaveLength(2);
	});

	it("reports a crash with no search when idle and ignores one after terminate", async () => {
		const fake = fakeConnections();
		const host = new WorkerEngineHost(fake.connect);
		const crashes: EngineCrash[] = [];
		const unsubscribe = host.onCrash((crash) => crashes.push(crash));
		await host.start(pinA, { hashMb: 64 });
		fake.handlers[0]?.onFailure(new Error("boom"));
		expect(crashes[0]?.searchId).toBeNull();
		fake.handlers[0]?.onFailure(new Error("again"));
		expect(crashes).toHaveLength(1);
		unsubscribe();
	});
});

describe("WorkerEngineHost notices", () => {
	it("records the effective Hash from the allocation-failure line without restarting", async () => {
		const fake = fakeConnections({
			onSetOption: (name) =>
				name === "Hash" ? [HASH_FAILED, "info string Hash: 16 MB, 0 MB on huge pages"] : [],
		});
		const host = new WorkerEngineHost(fake.connect);
		const notices: EngineNotice[] = [];
		host.onNotice((notice) => notices.push(notice));
		const session = await host.start(pinA, { hashMb: 1024 });
		expect(host.effectiveHashMb).toBe(16);
		expect(notices).toEqual([
			{ kind: "hash-allocation-failed", requestedMb: 1024, effectiveMb: 16 },
		]);
		expect(fake.engines).toHaveLength(1);
		expect(fake.engines[0]?.terminated).toBe(false);
		expect(session.capabilities).not.toBeNull();
	});

	it("emits engine errors as notices and keeps the worker", async () => {
		const fake = fakeConnections();
		const host = new WorkerEngineHost(fake.connect);
		const notices: EngineNotice[] = [];
		const unsubscribe = host.onNotice((notice) => notices.push(notice));
		await host.start(pinA, { hashMb: 64 });
		fake.engines[0]?.emit("info string error: OutOfMemory");
		expect(notices).toEqual([{ kind: "engine-error", message: "OutOfMemory" }]);
		expect(fake.engines[0]?.terminated).toBe(false);
		unsubscribe();
		fake.engines[0]?.emit("info string error: again");
		expect(notices).toHaveLength(1);
	});
});
