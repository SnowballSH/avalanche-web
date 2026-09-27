import { describe, expect, it } from "vitest";
import { SearchAbortedError, UciSessionRuntime } from "../../src/lib/engine/session";
import type { SearchInfo } from "../../src/lib/engine/types";
import { FakeEngine } from "./helpers/fake-engine";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const INFO_DEPTH_1 =
	"info depth 1 seldepth 1 multipv 1 score cp 30 nodes 20 nps 20000 time 1 pv e2e4";
const INFO_DEPTH_2 =
	"info depth 2 seldepth 2 multipv 1 score cp 25 nodes 60 nps 30000 time 2 pv e2e4 e7e5";

function sessionWithFake(engine = new FakeEngine()): {
	engine: FakeEngine;
	session: UciSessionRuntime;
} {
	const session = new UciSessionRuntime(engine);
	engine.onLine((line) => session.receive(line));
	return { engine, session };
}

async function started(): Promise<{ engine: FakeEngine; session: UciSessionRuntime }> {
	const pair = sessionWithFake();
	await pair.session.handshake();
	return pair;
}

async function collect(infos: AsyncIterable<SearchInfo>): Promise<SearchInfo[]> {
	const seen: SearchInfo[] = [];
	for await (const info of infos) seen.push(info);
	return seen;
}

describe("UciSessionRuntime handshake", () => {
	it("has no capabilities before the handshake", () => {
		const { session } = sessionWithFake();
		expect(session.capabilities).toBeNull();
	});

	it("sends uci and derives the capabilities from the option lines", async () => {
		const { engine, session } = sessionWithFake();
		const capabilities = await session.handshake();
		expect(engine.commands).toEqual(["uci"]);
		expect(capabilities.options.get("Hash")).toEqual({
			kind: "spin",
			default: 16,
			min: 1,
			max: 1048576,
		});
		expect(capabilities.threadsMax).toBe(1);
		expect(capabilities.multiPvMax).toBe(256);
		expect(capabilities.eloRange).toEqual({ min: 1320, max: 3000, default: 3000 });
		expect(capabilities.supportsChess960).toBe(true);
		expect(session.capabilities).toBe(capabilities);
	});

	it("is idempotent and never re-sends uci", async () => {
		const { engine, session } = sessionWithFake();
		const first = session.handshake();
		const second = session.handshake();
		expect(await second).toBe(await first);
		expect(await session.handshake()).toBe(await first);
		expect(engine.commands).toEqual(["uci"]);
	});
});

describe("UciSessionRuntime search", () => {
	it("assigns strictly increasing search ids", async () => {
		const { engine, session } = await started();
		const first = session.search({ depth: 1 });
		engine.emit("bestmove e2e4");
		const second = session.search({ depth: 1 });
		engine.emit("bestmove d2d4");
		const third = session.search({ depth: 1 });
		expect([first.searchId, second.searchId, third.searchId]).toEqual([1, 2, 3]);
	});

	it("never issues a bare go", async () => {
		const { engine, session } = await started();
		session.search({});
		engine.emit("bestmove e2e4");
		session.search({ infinite: true });
		engine.emit("bestmove e2e4");
		expect(engine.commandsMatching("go")).toEqual(["go infinite", "go infinite"]);
	});

	it("formats bounded limits and ponder", async () => {
		const { engine, session } = await started();
		session.search({ depth: 8 });
		engine.emit("bestmove e2e4");
		session.search({ wtime: 60000, btime: 55000, winc: 1000, binc: 1000, movestogo: 40 });
		engine.emit("bestmove e2e4");
		session.search({ nodes: 5000, movetime: 200, ponder: true });
		engine.emit("bestmove e2e4");
		session.search({ infinite: true, ponder: true });
		engine.emit("bestmove e2e4");
		expect(engine.commandsMatching("go")).toEqual([
			"go depth 8",
			"go wtime 60000 btime 55000 winc 1000 binc 1000 movestogo 40",
			"go ponder nodes 5000 movetime 200",
			"go ponder infinite",
		]);
	});

	it("streams info lines tagged with the search id and resolves the bestmove", async () => {
		const { engine, session } = await started();
		const handle = session.search({ depth: 2 });
		engine.emit(INFO_DEPTH_1, "info string Hash: 16 MB, 0 MB on huge pages", INFO_DEPTH_2);
		engine.emit("bestmove e2e4 ponder e7e5");
		const infos = await collect(handle.info);
		expect(infos.map((info) => [info.searchId, info.depth])).toEqual([
			[1, 1],
			[1, 2],
		]);
		await expect(handle.result).resolves.toEqual({ searchId: 1, move: "e2e4", ponder: "e7e5" });
	});

	it("resolves the result with the bestmove that follows stop()", async () => {
		const { engine, session } = await started();
		const handle = session.search({ infinite: true });
		handle.stop();
		expect(engine.commands.at(-1)).toBe("stop");
		engine.emit(INFO_DEPTH_1, "bestmove e2e4");
		await expect(handle.result).resolves.toEqual({ searchId: 1, move: "e2e4" });
		expect(await collect(handle.info)).toHaveLength(1);
	});

	it("maps bestmove 0000 to a null move", async () => {
		const { engine, session } = await started();
		const handle = session.search({ depth: 1 });
		engine.emit("info depth 0 score mate 0", "bestmove 0000");
		await expect(handle.result).resolves.toEqual({ searchId: 1, move: null });
	});

	it("sends stop and ponderhit only while that search is still running", async () => {
		const { engine, session } = await started();
		const handle = session.search({ infinite: true, ponder: true });
		handle.ponderhit();
		expect(engine.commands.at(-1)).toBe("ponderhit");
		engine.emit("bestmove e2e4");
		await handle.result;
		handle.ponderhit();
		handle.stop();
		expect(engine.commandsMatching("ponderhit")).toHaveLength(1);
		expect(engine.commandsMatching("stop")).toHaveLength(0);
	});

	it("stops the running search before starting another", async () => {
		const { engine, session } = await started();
		const first = session.search({ infinite: true });
		const second = session.search({ depth: 3 });
		expect(engine.commands.slice(-3)).toEqual(["go infinite", "stop", "go depth 3"]);
		engine.emit(INFO_DEPTH_1, "bestmove e2e4", INFO_DEPTH_2, "bestmove d2d4");
		await expect(first.result).resolves.toEqual({ searchId: 1, move: "e2e4" });
		await expect(second.result).resolves.toEqual({ searchId: 2, move: "d2d4" });
		expect((await collect(second.info)).map((info) => info.searchId)).toEqual([2]);
	});
});

describe("UciSessionRuntime position changes", () => {
	it("stops the running search before sending the new position", async () => {
		const { engine, session } = await started();
		const handle = session.search({ infinite: true });
		const positioned = session.position(START_FEN, ["e2e4"]);
		expect(engine.commands.slice(-4)).toEqual([
			"go infinite",
			"stop",
			`position fen ${START_FEN} moves e2e4`,
			"isready",
		]);
		engine.emit("bestmove e2e4");
		await positioned;
		await expect(handle.result).resolves.toEqual({ searchId: 1, move: "e2e4" });
	});

	it("drops the superseded search's lines instead of rendering them against the new position", async () => {
		const { engine, session } = await started();
		const stale = session.search({ infinite: true });
		engine.emit(INFO_DEPTH_1);
		await session.position(START_FEN, ["e2e4"]);
		const fresh = session.search({ infinite: true });

		engine.emit(INFO_DEPTH_2, "bestmove e2e4");
		engine.emit("info depth 1 seldepth 1 multipv 1 score cp -20 nodes 10 nps 10000 time 1 pv e7e5");
		engine.emit("bestmove e7e5");

		const staleInfos = await collect(stale.info);
		expect(staleInfos.map((info) => info.depth)).toEqual([1]);
		await expect(stale.result).resolves.toEqual({ searchId: 1, move: "e2e4" });

		const freshInfos = await collect(fresh.info);
		expect(freshInfos).toHaveLength(1);
		expect(freshInfos[0]?.searchId).toBe(2);
		expect(freshInfos[0]?.pv).toEqual(["e7e5"]);
		await expect(fresh.result).resolves.toEqual({ searchId: 2, move: "e7e5" });
	});

	it("sends position without moves when there are none", async () => {
		const { engine, session } = await started();
		await session.position(START_FEN, []);
		expect(engine.commands.slice(-2)).toEqual([`position fen ${START_FEN}`, "isready"]);
	});

	it("sends ucinewgame and waits for readyok", async () => {
		const { engine, session } = await started();
		await session.newGame();
		expect(engine.commands.slice(-2)).toEqual(["ucinewgame", "isready"]);
	});
});

describe("UciSessionRuntime setOption", () => {
	it("requires the handshake first", async () => {
		const { session } = sessionWithFake();
		await expect(session.setOption("Hash", 64)).rejects.toThrow(/handshake/);
	});

	it("sends a valid spin value under the advertised name", async () => {
		const { engine, session } = await started();
		await session.setOption("hash", 64);
		expect(engine.commands.slice(-2)).toEqual(["setoption name Hash value 64", "isready"]);
	});

	it("rejects an out-of-range spin value without sending it", async () => {
		const { engine, session } = await started();
		await expect(session.setOption("MultiPV", 257)).rejects.toThrow(RangeError);
		await expect(session.setOption("UCI_Elo", 1000)).rejects.toThrow(RangeError);
		await expect(session.setOption("Hash", 1.5)).rejects.toThrow(RangeError);
		expect(engine.commandsMatching("setoption")).toEqual([]);
	});

	it("rejects an unknown option and a wrongly typed value", async () => {
		const { engine, session } = await started();
		await expect(session.setOption("Syzygy", "x")).rejects.toThrow(RangeError);
		await expect(session.setOption("Ponder", 1)).rejects.toThrow(RangeError);
		await expect(session.setOption("Hash", "big")).rejects.toThrow(RangeError);
		expect(engine.commandsMatching("setoption")).toEqual([]);
	});

	it("sends check and button options", async () => {
		const { engine, session } = await started();
		await session.setOption("UCI_Chess960", true);
		await session.setOption("Clear Hash");
		expect(engine.commandsMatching("setoption")).toEqual([
			"setoption name UCI_Chess960 value true",
			"setoption name Clear Hash",
		]);
	});

	it("stops a running search before changing an option", async () => {
		const { engine, session } = await started();
		const handle = session.search({ infinite: true });
		const changed = session.setOption("MultiPV", 3);
		expect(engine.commands.slice(-4)).toEqual([
			"go infinite",
			"stop",
			"setoption name MultiPV value 3",
			"isready",
		]);
		engine.emit("bestmove e2e4");
		await changed;
		await handle.result;
	});
});

describe("UciSessionRuntime abort", () => {
	it("rejects the running search with SearchAbortedError on terminate", async () => {
		const { session } = await started();
		const handle = session.search({ infinite: true });
		session.abort("terminated");
		await expect(handle.result).rejects.toThrowError(
			expect.objectContaining({ name: "SearchAbortedError", reason: "terminated", searchId: 1 }),
		);
		await expect(handle.result).rejects.toBeInstanceOf(SearchAbortedError);
		expect(await collect(handle.info)).toEqual([]);
	});

	it("rejects with reason crashed and refuses further commands", async () => {
		const { engine, session } = await started();
		const handle = session.search({ depth: 5 });
		session.abort("crashed");
		await expect(handle.result).rejects.toMatchObject({ reason: "crashed" });
		expect(() => session.search({ depth: 1 })).toThrow(/aborted/);
		await expect(session.isReady()).rejects.toThrow(/aborted/);
		expect(engine.commands.at(-1)).toBe("go depth 5");
	});

	it("reports the running search id", async () => {
		const { engine, session } = await started();
		expect(session.runningSearchId).toBeNull();
		const handle = session.search({ depth: 5 });
		expect(session.runningSearchId).toBe(handle.searchId);
		engine.emit("bestmove e2e4");
		expect(session.runningSearchId).toBeNull();
	});
});
