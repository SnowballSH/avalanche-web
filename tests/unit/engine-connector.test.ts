import { describe, expect, it, vi } from "vitest";
import {
	EngineConnector,
	type EngineConnectorDeps,
	type EngineConnectorEvents,
	EngineConnectSupersededError,
} from "../../src/lib/analysis/engine-connector";
import { UciSessionRuntime } from "../../src/lib/engine/session";
import type { EngineStartOptions, UciSession } from "../../src/lib/engine/types";
import type { PinCatalogData, PinEntry } from "../../src/lib/pins/types";
import { FakeEngine } from "./helpers/fake-engine";

const pinA: PinEntry = {
	id: "master-9b7ee6f",
	commit: "9b7ee6ff829dcfb5ee5e48d8dcb83bd44c26a642",
	label: "A",
	date: "2026-09-27",
	sha256: "ab".repeat(32),
	bytes: 100,
};

const pinB: PinEntry = { ...pinA, id: "master-910711f", label: "B", sha256: "cd".repeat(32) };

const catalogue: PinCatalogData = { abi: 1, pins: [pinA, pinB] };

const readySession = async (): Promise<UciSession> => {
	const engine = new FakeEngine();
	const session = new UciSessionRuntime(engine);
	engine.onLine((line) => session.receive(line));
	await session.handshake();
	return session;
};

const setup = () => {
	const downloads = new Map<string, PromiseWithResolvers<void>>();
	const progress = new Map<string, (fraction: number) => void>();
	const ensure = vi.fn(
		async (_pin: PinEntry, _options: EngineStartOptions): Promise<UciSession> => readySession(),
	);
	const deps: EngineConnectorDeps = {
		catalogue: async () => catalogue,
		defaultPin: (data) => data.pins[0] ?? null,
		download: (pin, onProgress) => {
			const pending = Promise.withResolvers<void>();
			downloads.set(pin.id, pending);
			if (onProgress) progress.set(pin.id, onProgress);
			return pending.promise;
		},
		ensure,
		effectiveHashMb: () => 64,
	};
	const events = {
		onCatalogue: vi.fn<EngineConnectorEvents["onCatalogue"]>(),
		onProgress: vi.fn<EngineConnectorEvents["onProgress"]>(),
		onReady: vi.fn<EngineConnectorEvents["onReady"]>(),
	};
	return { connector: new EngineConnector(deps, events), downloads, progress, ensure, events };
};

describe("EngineConnector", () => {
	it("downloads the chosen pin with progress, then starts it", async () => {
		const { connector, downloads, progress, ensure, events } = setup();
		const connecting = connector.connect({ pinId: pinB.id, hashMb: 64, threads: 1 });
		await vi.waitFor(() => expect(downloads.has(pinB.id)).toBe(true));
		progress.get(pinB.id)?.(0.5);
		downloads.get(pinB.id)?.resolve();
		await connecting;
		expect(ensure).toHaveBeenCalledWith(pinB, { hashMb: 64 });
		expect(events.onProgress.mock.calls.map(([fraction]) => fraction)).toEqual([0, 0.5, null]);
		expect(events.onReady).toHaveBeenCalledWith({ pin: pinB, effectiveHashMb: 64, threadsMax: 1 });
	});

	it("passes Threads only above one", async () => {
		const { connector, downloads, ensure } = setup();
		const connecting = connector.connect({ pinId: pinA.id, hashMb: 32, threads: 2 });
		await vi.waitFor(() => expect(downloads.has(pinA.id)).toBe(true));
		downloads.get(pinA.id)?.resolve();
		await connecting;
		expect(ensure).toHaveBeenCalledWith(pinA, { hashMb: 32, threads: 2 });
	});

	it("never starts a superseded pin nor lets it touch the page state", async () => {
		const { connector, downloads, progress, ensure, events } = setup();
		const first = connector.connect({ pinId: pinA.id, hashMb: 64, threads: 1 });
		await vi.waitFor(() => expect(downloads.has(pinA.id)).toBe(true));
		const second = connector.connect({ pinId: pinB.id, hashMb: 64, threads: 1 });
		await vi.waitFor(() => expect(downloads.has(pinB.id)).toBe(true));
		downloads.get(pinB.id)?.resolve();
		await second;
		events.onProgress.mockClear();

		progress.get(pinA.id)?.(0.9);
		downloads.get(pinA.id)?.resolve();
		await expect(first).rejects.toBeInstanceOf(EngineConnectSupersededError);
		expect(ensure).toHaveBeenCalledTimes(1);
		expect(ensure).toHaveBeenCalledWith(pinB, { hashMb: 64 });
		expect(events.onProgress).not.toHaveBeenCalled();
		expect(events.onReady).toHaveBeenCalledTimes(1);
	});

	it("drops a session that came up after it was superseded", async () => {
		const { connector, downloads, ensure, events } = setup();
		const late = Promise.withResolvers<UciSession>();
		ensure.mockImplementationOnce(() => late.promise);
		const first = connector.connect({ pinId: pinA.id, hashMb: 64, threads: 1 });
		await vi.waitFor(() => expect(downloads.has(pinA.id)).toBe(true));
		downloads.get(pinA.id)?.resolve();
		await vi.waitFor(() => expect(ensure).toHaveBeenCalledTimes(1));
		const second = connector.connect({ pinId: pinA.id, hashMb: 128, threads: 1 });
		late.resolve(await readySession());
		await expect(first).rejects.toBeInstanceOf(EngineConnectSupersededError);
		downloads.get(pinA.id)?.resolve();
		await second;
		expect(events.onReady).toHaveBeenCalledTimes(1);
		expect(events.onReady.mock.calls[0]?.[0].pin).toBe(pinA);
	});

	it("falls back to the default pin when the chosen one is gone", async () => {
		const { connector, downloads, ensure } = setup();
		const connecting = connector.connect({ pinId: "retired", hashMb: 64, threads: 1 });
		await vi.waitFor(() => expect(downloads.has(pinA.id)).toBe(true));
		downloads.get(pinA.id)?.resolve();
		await connecting;
		expect(ensure).toHaveBeenCalledWith(pinA, { hashMb: 64 });
	});
});
