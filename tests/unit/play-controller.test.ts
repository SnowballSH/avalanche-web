import { INITIAL_FEN } from "chessops/fen";
import { describe, expect, it, vi } from "vitest";
import { WorkerEngineHost } from "../../src/lib/engine/host";
import { createScheduler } from "../../src/lib/engine/scheduler";
import { EngineSessionCache } from "../../src/lib/engine/session-cache";
import type { EngineStartOptions } from "../../src/lib/engine/types";
import type { PinEntry, PinId } from "../../src/lib/pins/types";
import { PlayController } from "../../src/lib/play/controller";
import { createPlayStore, type PlayStorage } from "../../src/lib/play/persist";
import type { PlaySettings } from "../../src/lib/play/types";
import { FAKE_OPTION_LINES, type FakeEngine, fakeConnections } from "./helpers/fake-engine";

const pin: PinEntry = {
	id: "master-9b7ee6f",
	commit: "9b7ee6ff829dcfb5ee5e48d8dcb83bd44c26a642",
	label: "4.0.0+ (master, 2026-09-27)",
	date: "2026-09-27",
	sha256: "ab".repeat(32),
	bytes: 25_698_005,
};

const memoryStorage = (): PlayStorage => {
	const items = new Map<string, string>();
	return {
		getItem: (key) => items.get(key) ?? null,
		setItem: (key, value) => {
			items.set(key, value);
		},
		removeItem: (key) => {
			items.delete(key);
		},
	};
};

const settingsWith = (overrides: Partial<PlaySettings> = {}): PlaySettings => ({
	side: "white",
	start: { kind: "standard" },
	pinId: pin.id,
	strength: { kind: "full" },
	timeControl: { baseMs: 60_000, incrementMs: 0 },
	engineLimit: null,
	hashMb: 64,
	threads: null,
	ponder: false,
	...overrides,
});

interface HarnessOptions {
	readonly optionLines?: readonly string[];
	readonly storage?: PlayStorage;
	readonly startMs?: number;
}

const harness = (options: HarnessOptions = {}) => {
	const fake = fakeConnections(options.optionLines ? { optionLines: options.optionLines } : {});
	const cache = new EngineSessionCache(new WorkerEngineHost(fake.connect));
	const connect = vi.fn((_pinId: PinId, startOptions: EngineStartOptions) =>
		cache.ensure(pin, startOptions),
	);
	let current = options.startMs ?? 10_000;
	const time = {
		now: () => current,
		advance: (ms: number) => {
			current += ms;
		},
	};
	const storage = options.storage ?? memoryStorage();
	const store = createPlayStore(storage);
	const scheduler = createScheduler();
	const saveFile = vi.fn<(name: string, text: string) => void>();
	const controller = new PlayController({
		scheduler,
		connect,
		now: time.now,
		store,
		saveFile,
		wallClock: () => new Date("2026-09-27T10:00:00.000Z"),
	});
	const engine = (): FakeEngine => {
		const latest = fake.engines.at(-1);
		if (!latest) throw new Error("no engine started");
		return latest;
	};
	return { fake, connect, time, storage, store, scheduler, controller, engine, saveFile };
};

type Harness = ReturnType<typeof harness>;

const goCommands = (engine: FakeEngine) => engine.commandsMatching("go");

const waitForGo = (h: Harness, count: number) =>
	vi.waitFor(() => expect(goCommands(h.engine())).toHaveLength(count));

const mainline = (h: Harness) => {
	const { tree } = h.controller.state;
	return tree
		.mainline()
		.slice(1)
		.map((id) => tree.node(id).move);
};

const engineReplies = async (h: Harness, move: string, extra: readonly string[] = []) => {
	const before = mainline(h).length;
	h.engine().emit(...extra, `bestmove ${move}`);
	await vi.waitFor(() => expect(mainline(h).length).toBeGreaterThan(before));
};

const playRound = async (
	h: Harness,
	user: string,
	reply: string,
	round: number,
	cp: number | null = 0,
) => {
	expect(h.controller.userMove(user)).toBe(true);
	await waitForGo(h, round);
	await engineReplies(h, reply, cp === null ? [] : [`info depth 6 score cp ${cp} pv ${reply}`]);
};

const started = async (overrides: Partial<PlaySettings> = {}, options: HarnessOptions = {}) => {
	const h = harness(options);
	await h.controller.start(settingsWith(overrides));
	expect(h.controller.state.phase).toBe("playing");
	return h;
};

describe("PlayController", () => {
	it("gives the engine wtime, btime, winc and binc from the clock", async () => {
		const h = await started({
			timeControl: { baseMs: 60_000, incrementMs: 2_000 },
			engineLimit: { kind: "nodes", value: 500 },
		});
		h.time.advance(3_000);
		expect(h.controller.userMove("e2e4")).toBe(true);
		await waitForGo(h, 1);
		expect(goCommands(h.engine())[0]).toBe(
			"go nodes 500 wtime 59000 btime 59900 winc 2000 binc 2000",
		);
		expect(h.engine().commandsMatching("position").at(-1)).toBe(
			`position fen ${INITIAL_FEN} moves e2e4`,
		);

		h.time.advance(1_500);
		await engineReplies(h, "e7e5");
		expect(h.controller.remaining("black")).toBe(60_500);
		h.time.advance(1_000);
		expect(h.controller.remaining("white")).toBe(58_000);
	});

	it("sets UCI_LimitStrength and UCI_Elo for an Elo setting", async () => {
		const h = await started({ strength: { kind: "elo", elo: 1500 } });
		expect(h.engine().commandsMatching("setoption name UCI_")).toEqual(
			expect.arrayContaining([
				"setoption name UCI_LimitStrength value true",
				"setoption name UCI_Elo value 1500",
			]),
		);
	});

	it("clears UCI_LimitStrength and resets UCI_Elo at full strength", async () => {
		const h = await started({ strength: { kind: "full" } });
		const strength = h.engine().commandsMatching("setoption name UCI_LimitStrength");
		expect(strength).toEqual(["setoption name UCI_LimitStrength value false"]);
		expect(h.engine().commandsMatching("setoption name UCI_Elo")).toEqual([
			"setoption name UCI_Elo value 3000",
		]);
	});

	it("resets MultiPV to 1 and sets UCI_Chess960 for an FRC start", async () => {
		const h = await started({ start: { kind: "frc", scharnagl: 0 } });
		const commands = h.engine().commands;
		expect(commands).toContain("ucinewgame");
		expect(commands).toContain("setoption name MultiPV value 1");
		expect(commands).toContain("setoption name UCI_Chess960 value true");
	});

	it("connects without Threads when one thread is asked for", async () => {
		const h = await started({ threads: null });
		expect(h.connect.mock.calls.map((call) => call[1])).toEqual([{ hashMb: 64 }]);
		expect(h.engine().commandsMatching("setoption name Threads")).toEqual([]);
	});

	it("never sends Threads to a pin whose Threads max is 1", async () => {
		const h = harness();
		await h.controller.start(settingsWith({ threads: 4 }));
		expect(h.controller.state.engine.kind).toBe("failed");
		expect(h.fake.engines).toHaveLength(1);
		expect(h.engine().commandsMatching("setoption name Threads")).toEqual([]);
	});

	it("connects once with Threads when the pin advertises more than one", async () => {
		const optionLines = FAKE_OPTION_LINES.map((line) =>
			line.startsWith("option name Threads")
				? "option name Threads type spin default 1 min 1 max 8"
				: line,
		);
		const h = await started({ threads: 4 }, { optionLines });
		expect(h.connect.mock.calls.map((call) => call[1])).toEqual([{ hashMb: 64, threads: 4 }]);
		expect(h.fake.engines).toHaveLength(1);
		expect(h.engine().commandsMatching("setoption name Threads")).toEqual([
			"setoption name Threads value 4",
		]);
	});

	it("lets the engine open when the user plays Black", async () => {
		const h = await started({ side: "black" });
		await waitForGo(h, 1);
		expect(h.engine().commandsMatching("position").at(-1)).toBe(`position fen ${INITIAL_FEN}`);
		await engineReplies(h, "d2d4");
		expect(h.controller.userMove("d7d5")).toBe(true);
	});

	it("refuses a move out of turn or an illegal one", async () => {
		const h = await started();
		expect(h.controller.userMove("e2e5")).toBe(false);
		expect(h.controller.userMove("e2e4")).toBe(true);
		expect(h.controller.userMove("d2d4")).toBe(false);
	});

	it("plays a premove immediately after the engine moves", async () => {
		const h = await started();
		h.controller.userMove("e2e4");
		await waitForGo(h, 1);
		h.controller.premove("g1f3");
		expect(h.controller.state.premove).toBe("g1f3");
		await engineReplies(h, "e7e5");
		expect(mainline(h)).toEqual(["e2e4", "e7e5", "g1f3"]);
		expect(h.controller.state.premove).toBeNull();
		await waitForGo(h, 2);
	});

	it("drops a premove that the engine's reply made illegal", async () => {
		const h = await started();
		h.controller.userMove("e2e4");
		await waitForGo(h, 1);
		h.controller.premove("e4e5");
		await engineReplies(h, "e7e5");
		expect(mainline(h)).toEqual(["e2e4", "e7e5"]);
		expect(h.controller.state.premove).toBeNull();
	});

	it("takes back the last user move and the engine's reply", async () => {
		const h = await started();
		await playRound(h, "e2e4", "e7e5", 1);
		await playRound(h, "g1f3", "b8c6", 2);
		expect(h.controller.takeback()).toBe(true);
		expect(mainline(h)).toEqual(["e2e4", "e7e5"]);
		expect(h.controller.userMove("d2d4")).toBe(true);
		await waitForGo(h, 3);
		expect(h.engine().commandsMatching("position").at(-1)).toBe(
			`position fen ${INITIAL_FEN} moves e2e4 e7e5 d2d4`,
		);
	});

	it("takes back a move the engine is still thinking about and ignores its late reply", async () => {
		const h = await started();
		h.controller.userMove("e2e4");
		await waitForGo(h, 1);
		expect(h.controller.takeback()).toBe(true);
		expect(h.engine().commands.at(-1)).toBe("stop");
		expect(mainline(h)).toEqual([]);
		h.engine().emit("bestmove e7e5");
		await Promise.resolve();
		expect(mainline(h)).toEqual([]);
		expect(h.controller.state.tree.fenAt(h.controller.state.tree.root)).toBe(INITIAL_FEN);
	});

	it("refuses a takeback before the user has moved", async () => {
		const h = await started({ side: "black" });
		await waitForGo(h, 1);
		await engineReplies(h, "e2e4");
		expect(h.controller.takeback()).toBe(false);
		expect(mainline(h)).toEqual(["e2e4"]);
	});

	it("declines a draw offer until the engine's score stayed quiet for ten moves", async () => {
		const h = await started();
		const white = ["a2a3", "b2b3", "c2c3", "d2d3", "e2e3", "f2f3", "g2g3", "h2h3", "a3a4", "b3b4"];
		const black = ["a7a6", "b7b6", "c7c6", "d7d6", "e7e6", "f7f6", "g7g6", "h7h6", "a6a5", "b6b5"];
		for (const [index, move] of white.entries()) {
			await playRound(h, move, black[index] ?? "", index + 1, index === 0 ? 45 : 5);
		}
		expect(h.controller.offerDraw()).toBe(false);
		expect(h.controller.state.notice).toBe("Avalanche declines the draw.");
		expect(h.controller.result).toBeNull();

		await playRound(h, "c3c4", "c6c5", 11, -12);
		expect(h.controller.offerDraw()).toBe(true);
		expect(h.controller.result).toEqual({ winner: "draw", reason: "agreement" });
	});

	it("keeps the draw window one-to-one with the engine's moves", async () => {
		const h = await started();
		const white = [
			"a2a3",
			"b2b3",
			"c2c3",
			"d2d3",
			"e2e3",
			"f2f3",
			"g2g3",
			"h2h3",
			"a3a4",
			"b3b4",
			"c3c4",
		];
		const black = [
			"a7a6",
			"b7b6",
			"c7c6",
			"d7d6",
			"e7e6",
			"f7f6",
			"g7g6",
			"h7h6",
			"a6a5",
			"b6b5",
			"c6c5",
		];
		for (const [index, move] of white.entries()) {
			await playRound(h, move, black[index] ?? "", index + 1, index === 1 ? null : 0);
		}
		expect(h.controller.offerDraw()).toBe(false);
		await playRound(h, "d3d4", "d6d5", 12, 3);
		expect(h.controller.offerDraw()).toBe(true);
	});

	it("drops a scoreless engine move's placeholder on takeback", async () => {
		const h = await started();
		await playRound(h, "e2e4", "e7e5", 1, 17);
		await playRound(h, "g1f3", "b8c6", 2, null);
		expect(h.store.load()?.engineScores).toEqual([{ kind: "cp", value: 17 }, null]);
		h.controller.takeback();
		expect(h.store.load()?.engineScores).toEqual([{ kind: "cp", value: 17 }]);
	});

	it("dispose saves the game, stops the search and releases the lease", async () => {
		const h = await started();
		h.controller.userMove("e2e4");
		await waitForGo(h, 1);
		h.time.advance(2_000);
		h.controller.dispose();
		expect(h.engine().commands.at(-1)).toBe("stop");
		expect(h.store.load()?.clock).toEqual({ whiteMs: 60_000, blackMs: 58_000, running: "black" });
		expect(() => h.scheduler.acquire("play")).not.toThrow();
		h.engine().emit("bestmove e7e5");
		await Promise.resolve();
		expect(h.store.load()?.moves).toEqual(["e2e4"]);
	});

	it("ends the game on resignation and stops the engine", async () => {
		const h = await started();
		h.controller.userMove("e2e4");
		await waitForGo(h, 1);
		h.controller.resign();
		expect(h.controller.result).toEqual({ winner: "black", reason: "resign" });
		expect(h.controller.state.phase).toBe("over");
		expect(h.engine().commands.at(-1)).toBe("stop");
		expect(() => h.scheduler.acquire("play")).not.toThrow();
	});

	it.each([
		[
			"checkmate",
			"k7/8/1K6/8/8/8/8/7R w - - 0 1",
			"h1h8",
			{ winner: "white", reason: "checkmate" },
		],
		[
			"stalemate",
			"k7/8/1K6/8/8/8/8/2Q5 w - - 0 1",
			"c1c7",
			{ winner: "draw", reason: "stalemate" },
		],
		[
			"insufficient material",
			"k7/8/8/8/8/8/1r6/K7 w - - 0 1",
			"a1b2",
			{ winner: "draw", reason: "insufficient" },
		],
		[
			"the fifty-move rule",
			"k7/8/8/8/8/8/8/K6R w - - 99 80",
			"h1h2",
			{ winner: "draw", reason: "fifty-move" },
		],
	])("ends the game on %s after the user's move", async (_label, fen, move, result) => {
		const h = await started({ start: { kind: "fen", fen } });
		expect(h.controller.userMove(move)).toBe(true);
		expect(h.controller.result).toEqual(result);
		expect(h.controller.state.phase).toBe("over");
		expect(goCommands(h.engine())).toEqual([]);
	});

	it("ends the game when the engine checkmates", async () => {
		const h = await started();
		await playRound(h, "f2f3", "e7e5", 1);
		h.controller.userMove("g2g4");
		await waitForGo(h, 2);
		h.engine().emit("bestmove d8h4");
		await vi.waitFor(() =>
			expect(h.controller.result).toEqual({ winner: "black", reason: "checkmate" }),
		);
	});

	it("ends the game on threefold repetition", async () => {
		const h = await started();
		await playRound(h, "g1f3", "g8f6", 1);
		await playRound(h, "f3g1", "f6g8", 2);
		await playRound(h, "g1f3", "g8f6", 3);
		h.controller.userMove("f3g1");
		await waitForGo(h, 4);
		h.engine().emit("bestmove f6g8");
		await vi.waitFor(() =>
			expect(h.controller.result).toEqual({ winner: "draw", reason: "threefold" }),
		);
	});

	it("flags the user after a 30 s jump in the time source and ends the game", async () => {
		const h = await started({ timeControl: { baseMs: 20_000, incrementMs: 0 } });
		h.time.advance(100);
		h.controller.tick();
		expect(h.controller.result).toBeNull();
		h.time.advance(30_000);
		expect(h.controller.remaining("white")).toBe(0);
		h.controller.tick();
		expect(h.controller.result).toEqual({ winner: "black", reason: "flag" });
		expect(h.controller.userMove("e2e4")).toBe(false);
	});

	it("flags the engine, stops its search and ignores its late move", async () => {
		const h = await started({ timeControl: { baseMs: 5_000, incrementMs: 0 } });
		h.controller.userMove("e2e4");
		await waitForGo(h, 1);
		h.time.advance(5_000);
		h.controller.tick();
		expect(h.controller.result).toEqual({ winner: "white", reason: "flag" });
		expect(h.engine().commands.at(-1)).toBe("stop");
		h.engine().emit("bestmove e7e5");
		await Promise.resolve();
		expect(mainline(h)).toEqual(["e2e4"]);
	});

	it("rejects an engine move that arrives after its flag fell", async () => {
		const h = await started({ timeControl: { baseMs: 5_000, incrementMs: 0 } });
		h.controller.userMove("e2e4");
		await waitForGo(h, 1);
		h.time.advance(6_000);
		h.engine().emit("bestmove e7e5");
		await vi.waitFor(() =>
			expect(h.controller.result).toEqual({ winner: "white", reason: "flag" }),
		);
		expect(mainline(h)).toEqual(["e2e4"]);
	});

	it("ponders on the expected reply and sends ponderhit when it comes", async () => {
		const h = await started({ ponder: true });
		expect(h.engine().commands).toContain("setoption name Ponder value true");
		h.controller.userMove("e2e4");
		await waitForGo(h, 1);
		h.engine().emit("bestmove e7e5 ponder g1f3");
		await waitForGo(h, 2);
		expect(h.engine().commandsMatching("position").at(-1)).toBe(
			`position fen ${INITIAL_FEN} moves e2e4 e7e5 g1f3`,
		);
		expect(goCommands(h.engine())[1]).toMatch(/^go ponder wtime \d+ btime \d+ winc 0 binc 0$/);
		expect(h.controller.state.engine.kind).toBe("pondering");

		h.controller.userMove("g1f3");
		expect(h.engine().commands.at(-1)).toBe("ponderhit");
		expect(goCommands(h.engine())).toHaveLength(2);
		await engineReplies(h, "b8c6");
		expect(mainline(h)).toEqual(["e2e4", "e7e5", "g1f3", "b8c6"]);
	});

	it("stops pondering and searches the actual move when the user plays another", async () => {
		const h = await started({ ponder: true });
		h.controller.userMove("e2e4");
		await waitForGo(h, 1);
		h.engine().emit("bestmove e7e5 ponder g1f3");
		await waitForGo(h, 2);
		const ponderGo = h.engine().commands.lastIndexOf(goCommands(h.engine())[1] ?? "");
		h.controller.userMove("d2d4");
		const afterPonder = h.engine().commands.slice(ponderGo);
		expect(afterPonder).toContain("stop");
		expect(afterPonder).not.toContain("ponderhit");
		h.engine().emit("bestmove b8c6");
		await waitForGo(h, 3);
		expect(h.engine().commandsMatching("position").at(-1)).toBe(
			`position fen ${INITIAL_FEN} moves e2e4 e7e5 d2d4`,
		);
		expect(goCommands(h.engine())[2]).toMatch(/^go wtime/);
		expect(mainline(h)).toEqual(["e2e4", "e7e5", "d2d4"]);
		await engineReplies(h, "e5d4");
		expect(mainline(h)).toEqual(["e2e4", "e7e5", "d2d4", "e5d4"]);
	});

	it("never ponders when Ponder is off", async () => {
		const h = await started();
		expect(h.engine().commands).toContain("setoption name Ponder value false");
		h.controller.userMove("e2e4");
		await waitForGo(h, 1);
		await engineReplies(h, "e7e5", ["info depth 3 score cp 0 pv e7e5 g1f3"]);
		h.engine().emit("bestmove e7e5 ponder g1f3");
		await Promise.resolve();
		expect(goCommands(h.engine())).toHaveLength(1);
	});

	it("saves the game on every move", async () => {
		const h = await started();
		expect(h.store.load()?.moves).toEqual([]);
		h.controller.userMove("e2e4");
		expect(h.store.load()?.moves).toEqual(["e2e4"]);
		await waitForGo(h, 1);
		await engineReplies(h, "e7e5");
		expect(h.store.load()?.moves).toEqual(["e2e4", "e7e5"]);
		h.controller.takeback();
		expect(h.store.load()?.moves).toEqual([]);
	});

	it("resumes the same position and clocks after a reload", async () => {
		const storage = memoryStorage();
		const first = await started(
			{ timeControl: { baseMs: 60_000, incrementMs: 1_000 } },
			{ storage },
		);
		first.time.advance(4_000);
		first.controller.userMove("e2e4");
		await waitForGo(first, 1);
		first.time.advance(2_000);
		first.engine().emit("info depth 4 score cp 20 pv e7e5", "bestmove e7e5");
		await vi.waitFor(() => expect(mainline(first)).toHaveLength(2));
		first.time.advance(500);
		first.controller.userMove("g1f3");
		await waitForGo(first, 2);
		const saved = first.store.load();
		expect(saved?.clock).toEqual({ whiteMs: 57_500, blackMs: 59_000, running: "black" });

		const second = harness({ storage, startMs: 900_000 });
		expect(second.controller.resume()).toBe(true);
		expect(mainline(second)).toEqual(["e2e4", "e7e5", "g1f3"]);
		await vi.waitFor(() => expect(second.controller.state.phase).toBe("playing"));
		expect(second.controller.remaining("white")).toBe(57_500);
		expect(second.controller.remaining("black")).toBe(59_000);
		await waitForGo(second, 1);
		expect(goCommands(second.engine())[0]).toBe("go wtime 57500 btime 58900 winc 1000 binc 1000");
		second.time.advance(1_000);
		expect(second.controller.remaining("black")).toBe(58_000);
	});

	it("resumes a finished game without starting the engine", async () => {
		const storage = memoryStorage();
		const first = await started({}, { storage });
		first.controller.resign();
		const second = harness({ storage });
		expect(second.controller.resume()).toBe(true);
		expect(second.controller.state.phase).toBe("over");
		expect(second.controller.result).toEqual({ winner: "black", reason: "resign" });
		expect(second.fake.engines).toHaveLength(0);
	});

	it("exports the game with its result, and FRC tags for an FRC start", async () => {
		const h = await started({ start: { kind: "frc", scharnagl: 0 }, side: "white" });
		h.controller.userMove("e2e4");
		await waitForGo(h, 1);
		h.controller.resign();
		const pgn = h.controller.toAnalysis();
		expect(pgn).toContain('[Result "0-1"]');
		expect(pgn).toContain('[White "You"]');
		expect(pgn).toContain('[Black "Avalanche master-9b7ee6f"]');
		expect(pgn).toContain('[Variant "Chess960"]');
		expect(pgn).toContain('[FEN "bbqnnrkr/pppppppp/8/8/8/8/PPPPPPPP/BBQNNRKR w KQkq - 0 1"]');
		expect(pgn).toContain('[Date "2026.09.27"]');
		expect(pgn).toMatch(/1\. e4 0-1\n$/);

		h.controller.downloadPgn();
		expect(h.saveFile).toHaveBeenCalledWith("avalanche-2026-09-27.pgn", pgn);
	});
});
