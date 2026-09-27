/// <reference types="node" />
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type EngineConnectionFactory, WorkerEngineHost } from "../../src/lib/engine/host";
import type { EngineNotice, SearchInfo, UciSession } from "../../src/lib/engine/types";
import type { PinEntry } from "../../src/lib/pins/types";
import { startNodeClient } from "../../vendor/avalanche-web-abi1/src/node/client.ts";

const FIXTURE_PATH = process.env.AVALANCHE_FIXTURE_WASM
	? pathToFileURL(process.env.AVALANCHE_FIXTURE_WASM)
	: new URL("../../.cache/fixtures/avalanche-8c66796.wasm", import.meta.url);

const pin: PinEntry = {
	id: "master-8c66796",
	commit: "8c66796067c944c0188c62ee9254b8f421ffd19e",
	label: "4.0.0+ (master, 2026-09-27)",
	date: "2026-09-27",
	sha256: "fixture",
	bytes: 0,
};

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

const rawLines: string[] = [];

const connectNodeWorker: EngineConnectionFactory = async (_pin, handlers) => {
	const client = await startNodeClient(FIXTURE_PATH, {
		onLine: (line) => {
			rawLines.push(line);
			handlers.onLine(line);
		},
		onError: handlers.onFailure,
	});
	return {
		send: (command) => {
			if (!client.closed) client.send(command);
		},
		terminate: () => client.terminate(),
	};
};

async function firstInfo(infos: AsyncIterable<SearchInfo>): Promise<SearchInfo> {
	for await (const info of infos) return info;
	throw new Error("search produced no info line");
}

async function collect(infos: AsyncIterable<SearchInfo>): Promise<SearchInfo[]> {
	const seen: SearchInfo[] = [];
	for await (const info of infos) seen.push(info);
	return seen;
}

describe("EngineHost against the real 8c66796 wasm", () => {
	const host = new WorkerEngineHost(connectNodeWorker);
	const notices: EngineNotice[] = [];
	let session: UciSession;

	beforeAll(async () => {
		if (!existsSync(FIXTURE_PATH)) {
			throw new Error(
				`Fixture wasm missing at ${FIXTURE_PATH.pathname}; run scripts/fetch-fixture-wasm.sh or set AVALANCHE_FIXTURE_WASM`,
			);
		}
		host.onNotice((notice) => notices.push(notice));
		session = await host.start(pin, { hashMb: 64 });
	});

	afterAll(async () => {
		await host.terminate();
	});

	it("completes the handshake and applies Hash", () => {
		expect(session.capabilities?.options.get("Hash")?.kind).toBe("spin");
		expect(session.capabilities?.threadsMax).toBe(1);
		expect(session.capabilities?.multiPvMax).toBeGreaterThan(1);
		expect(host.effectiveHashMb).toBe(64);
		expect(notices).toEqual([]);
	});

	it("returns a bestmove for go depth 8", async () => {
		await session.newGame();
		await session.position(START_FEN, []);
		const handle = session.search({ depth: 8 });
		const infos = await collect(handle.info);
		const result = await handle.result;
		expect(infos.at(-1)?.depth).toBe(8);
		expect(infos.every((info) => info.searchId === handle.searchId)).toBe(true);
		expect(result.searchId).toBe(handle.searchId);
		expect(result.move).toMatch(UCI_MOVE);
	});

	it("stops go infinite within 500 ms", async () => {
		await session.position(START_FEN, ["e2e4"]);
		const handle = session.search({ infinite: true });
		await firstInfo(handle.info);
		const started = performance.now();
		handle.stop();
		const result = await handle.result;
		expect(performance.now() - started).toBeLessThan(500);
		expect(result.move).toMatch(UCI_MOVE);
	});

	it("drops the superseded search's lines once the position changes", async () => {
		const stale = session.search({ infinite: true });
		const staleInfos: SearchInfo[] = [];
		const firstStale = Promise.withResolvers<void>();
		let staleStreamEnded = false;
		const staleStream = (async () => {
			for await (const info of stale.info) {
				staleInfos.push(info);
				firstStale.resolve();
			}
			staleStreamEnded = true;
		})();
		await firstStale.promise;

		const rawBeforeChange = rawLines.length;
		await session.position(START_FEN, ["d2d4", "d7d5"]);
		await staleStream;
		const deliveredBeforeChange = staleInfos.length;
		const fresh = session.search({ depth: 6 });

		const staleResult = await stale.result;
		const freshInfos = await collect(fresh.info);
		const freshResult = await fresh.result;

		const rawAfterChange = rawLines.slice(rawBeforeChange);
		const staleTail = rawAfterChange.slice(
			0,
			rawAfterChange.findIndex((l) => l.startsWith("bestmove")),
		);
		expect(staleTail.some((line) => line.startsWith("info depth"))).toBe(true);
		expect(staleStreamEnded).toBe(true);
		expect(staleInfos).toHaveLength(deliveredBeforeChange);
		expect(staleInfos.every((info) => info.searchId === stale.searchId)).toBe(true);
		expect(staleResult.searchId).toBe(stale.searchId);
		expect(staleResult.move).toMatch(UCI_MOVE);
		expect(freshInfos.length).toBeGreaterThan(0);
		expect(freshInfos.every((info) => info.searchId === fresh.searchId)).toBe(true);
		expect(freshInfos.at(-1)?.depth).toBe(6);
		expect(freshResult.searchId).toBe(fresh.searchId);
	});

	it("restarts the worker on a Hash change and searches again", async () => {
		const previous = session;
		session = await host.restart({ hashMb: 128 });
		expect(session).not.toBe(previous);
		expect(host.effectiveHashMb).toBe(128);
		expect(session.capabilities).not.toBeNull();
		await session.position(START_FEN, []);
		const handle = session.search({ depth: 4 });
		expect((await handle.result).move).toMatch(UCI_MOVE);
	});

	it("keeps the old table and reports it when a Hash allocation fails", async () => {
		session = await host.restart({ hashMb: 1048576 });
		expect(host.effectiveHashMb).toBe(16);
		expect(notices.at(-1)).toEqual({
			kind: "hash-allocation-failed",
			requestedMb: 1048576,
			effectiveMb: 16,
		});
		await session.position(START_FEN, []);
		const handle = session.search({ depth: 2 });
		expect((await handle.result).move).toMatch(UCI_MOVE);
	});
});
