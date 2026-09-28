import { INITIAL_FEN } from "chessops/fen";
import { describe, expect, it, vi } from "vitest";
import { AnalysisController } from "../../src/lib/analysis/controller";
import { importPgn } from "../../src/lib/chess/pgn";
import { createScheduler } from "../../src/lib/engine/scheduler";
import { UciSessionRuntime } from "../../src/lib/engine/session";
import { FakeEngine } from "./helpers/fake-engine";

const setup = async () => {
	const engine = new FakeEngine();
	const session = new UciSessionRuntime(engine);
	engine.onLine((line) => session.receive(line));
	await session.handshake();
	const scheduler = createScheduler();
	const connect = vi.fn(async () => session);
	const controller = new AnalysisController({ scheduler, connect });
	return { engine, session, scheduler, connect, controller };
};

const goCount = (engine: FakeEngine) => engine.commandsMatching("go").length;

const lastPosition = (engine: FakeEngine) => engine.commandsMatching("position").at(-1);

const waitForGo = (engine: FakeEngine, count: number) =>
	vi.waitFor(() => expect(goCount(engine)).toBe(count));

describe("AnalysisController", () => {
	it("restarts the search on the new position when navigating", async () => {
		const { engine, controller } = await setup();
		await controller.setEngine(true);
		await waitForGo(engine, 1);
		expect(lastPosition(engine)).toBe(`position fen ${INITIAL_FEN}`);
		expect(engine.commandsMatching("go").at(-1)).toBe("go infinite");

		expect(controller.move("e2e4")).toBe(true);
		await waitForGo(engine, 2);
		expect(lastPosition(engine)).toBe(`position fen ${INITIAL_FEN} moves e2e4`);

		controller.goto(controller.state.tree.root);
		await waitForGo(engine, 3);
		expect(lastPosition(engine)).toBe(`position fen ${INITIAL_FEN}`);
		expect(controller.state.engine.kind).toBe("running");
	});

	it("drops lines from the search on the previous position", async () => {
		const { engine, controller } = await setup();
		await controller.setEngine(true);
		await waitForGo(engine, 1);
		controller.move("e2e4");
		engine.emit("info depth 9 multipv 1 score cp 33 pv d2d4 d7d5");
		await waitForGo(engine, 2);
		engine.emit("bestmove d2d4");
		await Promise.resolve();
		expect(controller.state.lines).toEqual([]);

		engine.emit("info depth 4 multipv 1 score cp -20 pv e7e5 g1f3");
		await vi.waitFor(() => expect(controller.state.lines).toHaveLength(1));
		expect(controller.state.lines[0]?.pv).toEqual(["e7e5", "g1f3"]);
		expect(controller.state.lines[0]?.score).toEqual({ kind: "cp", value: 20 });
	});

	it("yields three lines ordered by rank at MultiPV 3", async () => {
		const { engine, controller } = await setup();
		await controller.setEngine(true);
		await waitForGo(engine, 1);
		await controller.setMultiPv(3);
		expect(engine.commandsMatching("setoption name MultiPV").at(-1)).toBe(
			"setoption name MultiPV value 3",
		);
		await waitForGo(engine, 2);
		engine.emit(
			"bestmove e2e4",
			"info depth 6 multipv 3 score cp 5 pv b1c3",
			"info depth 6 multipv 1 score cp 30 pv e2e4",
			"info depth 6 multipv 2 score cp 25 pv d2d4",
		);
		await vi.waitFor(() => expect(controller.state.lines).toHaveLength(3));
		expect(controller.state.lines.map((line) => line.multipv)).toEqual([1, 2, 3]);
		expect(controller.state.lines.map((line) => line.san[0])).toEqual(["e4", "d4", "Nc3"]);
	});

	it("clamps MultiPV to the 1–5 range", async () => {
		const { controller } = await setup();
		await controller.setMultiPv(9);
		expect(controller.state.multiPv).toBe(5);
		await controller.setMultiPv(0);
		expect(controller.state.multiPv).toBe(1);
	});

	it("adds a clicked PV's moves to the tree and goes to the last one", async () => {
		const { engine, controller } = await setup();
		await controller.setEngine(true);
		await waitForGo(engine, 1);
		engine.emit("info depth 8 multipv 1 score cp 20 pv e2e4 e7e5 g1f3");
		await vi.waitFor(() => expect(controller.state.lines).toHaveLength(1));

		controller.playPv(1, 2);
		const { tree, current } = controller.state;
		expect(tree.mainline().map((id) => tree.sanAt(id))).toEqual([null, "e4", "e5"]);
		expect(tree.sanAt(current)).toBe("e5");
		await waitForGo(engine, 2);
		expect(lastPosition(engine)).toBe(`position fen ${INITIAL_FEN} moves e2e4 e7e5`);
	});

	it("records the best line's score as the node's evaluation", async () => {
		const { engine, controller } = await setup();
		await controller.setEngine(true);
		await waitForGo(engine, 1);
		engine.emit("info depth 12 multipv 1 score cp 41 pv e2e4");
		await vi.waitFor(() => expect(controller.state.lines).toHaveLength(1));
		const root = controller.state.tree.node(controller.state.tree.root);
		expect(root.eval?.depth).toBe(12);
		expect(root.eval?.score).toEqual({ kind: "cp", value: 41 });
	});

	it("stores a Black-to-move evaluation from the side to move and exports it from White's side", async () => {
		const { engine, controller } = await setup();
		controller.move("e2e4");
		await controller.setEngine(true);
		await waitForGo(engine, 1);
		engine.emit("info depth 10 multipv 1 score cp -35 pv e7e5");
		await vi.waitFor(() => expect(controller.state.lines).toHaveLength(1));
		const node = controller.state.tree.node(controller.state.current);
		expect(node.eval?.score).toEqual({ kind: "cp", value: -35 });
		expect(controller.state.lines[0]?.score).toEqual({ kind: "cp", value: 35 });
		expect(controller.exportPgn(true)).toContain("1. e4 { [%eval 0.35,10] } *");
	});

	it("bumps the revision only when a line changes a stored evaluation", async () => {
		const { engine, controller } = await setup();
		await controller.setEngine(true);
		await waitForGo(engine, 1);
		engine.emit("info depth 10 multipv 1 score cp 30 pv e2e4");
		await vi.waitFor(() => expect(controller.state.lines).toHaveLength(1));
		const revision = controller.state.revision;
		engine.emit("info depth 9 multipv 1 score cp 10 pv d2d4");
		engine.emit("info depth 11 multipv 1 score cp 50 lowerbound pv e2e4");
		await vi.waitFor(() => expect(controller.state.lines[0]?.depth).toBe(11));
		expect(controller.state.revision).toBe(revision);
		engine.emit("info depth 12 multipv 1 score cp 31 pv e2e4");
		await vi.waitFor(() => expect(controller.state.revision).toBe(revision + 1));
	});

	it("reports a crash while applying options with the friendly crash message", async () => {
		const { session, controller } = await setup();
		session.abort("crashed");
		await controller.setEngine(true);
		expect(controller.state.engine).toEqual({
			kind: "failed",
			message: "The engine crashed. Switch it on again to restart it.",
		});
	});

	it("sets UCI_Chess960 for an FRC start and clears it for a standard one", async () => {
		const { engine, controller } = await setup();
		expect(controller.load({ kind: "frc", scharnagl: 0 }).ok).toBe(true);
		await controller.setEngine(true);
		await waitForGo(engine, 1);
		const frcSet = engine.commands.indexOf("setoption name UCI_Chess960 value true");
		expect(frcSet).toBeGreaterThanOrEqual(0);
		expect(frcSet).toBeLessThan(engine.commands.indexOf(lastPosition(engine) ?? ""));
		expect(lastPosition(engine)).toBe(`position fen ${controller.state.tree.fenAt(0)}`);

		controller.load({ kind: "standard" });
		await waitForGo(engine, 2);
		expect(engine.commandsMatching("setoption name UCI_Chess960").at(-1)).toBe(
			"setoption name UCI_Chess960 value false",
		);
	});

	it("loads a #fen= link", async () => {
		const { controller } = await setup();
		controller.loadHash("#fen=4k3/8/8/8/8/8/8/4K2R_w_K_-_0_1");
		const { tree, notice } = controller.state;
		expect(tree.fenAt(tree.root)).toBe("4k3/8/8/8/8/8/8/4K2R w K - 0 1");
		expect(tree.start).toEqual({ kind: "fen", fen: "4k3/8/8/8/8/8/8/4K2R w K - 0 1" });
		expect(notice).toBeNull();
	});

	it("shows an error for an invalid #fen= link and keeps the default position", async () => {
		const { controller } = await setup();
		controller.loadHash("#fen=not/a/fen");
		const { tree, notice } = controller.state;
		expect(tree.fenAt(tree.root)).toBe(INITIAL_FEN);
		expect(notice?.kind).toBe("error");
		expect(notice?.text).toMatch(/Invalid FEN/);
	});

	it("echoes the normalised FEN of a link whose castling rights were dropped", async () => {
		const { controller } = await setup();
		controller.loadHash("#fen=4k3/8/8/8/8/8/8/4K3_w_K_-_0_1");
		const { tree, notice } = controller.state;
		expect(tree.fenAt(tree.root)).toBe("4k3/8/8/8/8/8/8/4K3 w - - 0 1");
		expect(notice).toEqual({
			kind: "info",
			text: "Loaded as 4k3/8/8/8/8/8/8/4K3 w - - 0 1",
		});
	});

	it("keeps the tree when an imported game has an illegal move", async () => {
		const { controller } = await setup();
		controller.move("e2e4");
		const before = controller.state.tree;
		const games = importPgn("1. e4 e5 2. Ke3 *");
		if (!games.ok) throw new Error("the PGN should parse");
		const [game] = games.value;
		if (!game) throw new Error("one game expected");
		const result = controller.load(game);
		expect(result.ok).toBe(false);
		expect(controller.state.tree).toBe(before);
		expect(controller.state.tree.mainline()).toHaveLength(2);
	});

	it("keeps an imported game's headers when exporting", async () => {
		const { controller } = await setup();
		const games = importPgn('[Event "Club"]\n[White "Ann"]\n\n1. e4 *');
		if (!games.ok || !games.value[0]) throw new Error("the PGN should parse");
		controller.load(games.value[0]);
		expect(controller.exportPgn(false)).toContain('[Event "Club"]');
		expect(controller.exportPgn(false)).toContain('[White "Ann"]');
		controller.load({ kind: "standard" });
		expect(controller.exportPgn(false)).toContain('[Event "?"]');
	});

	it("stops its search while play holds the engine and resumes it afterwards", async () => {
		const { engine, scheduler, controller } = await setup();
		await controller.setEngine(true);
		await waitForGo(engine, 1);
		const stopsBefore = engine.commandsMatching("stop").length;

		const play = scheduler.acquire("play");
		expect(controller.state.engine.kind).toBe("suspended");
		expect(engine.commandsMatching("stop").length).toBe(stopsBefore + 1);
		expect(controller.state.lines).toEqual([]);

		scheduler.release(play);
		await waitForGo(engine, 2);
		expect(controller.state.engine.kind).toBe("running");
	});

	it("releases its lease and stops when the engine is switched off", async () => {
		const { engine, scheduler, controller } = await setup();
		await controller.setEngine(true);
		await waitForGo(engine, 1);
		await controller.setEngine(false);
		expect(engine.commands.at(-1)).toBe("stop");
		expect(controller.state.engine.kind).toBe("off");
		expect(() => scheduler.acquire("analysis")).not.toThrow();
	});

	it("reports a failed connection and retries on the next switch-on", async () => {
		const { engine, session, scheduler } = await setup();
		const connect = vi
			.fn<() => Promise<UciSessionRuntime>>()
			.mockRejectedValueOnce(new Error("Download failed"))
			.mockResolvedValue(session);
		const controller = new AnalysisController({ scheduler, connect });
		await controller.setEngine(true);
		await vi.waitFor(() =>
			expect(controller.state.engine).toEqual({ kind: "failed", message: "Download failed" }),
		);
		await controller.setEngine(true);
		await waitForGo(engine, 1);
		expect(controller.state.engine.kind).toBe("running");
	});

	it("navigates with next, previous, first, last and sibling", async () => {
		const { controller } = await setup();
		controller.move("e2e4");
		controller.move("e7e5");
		controller.goto(controller.state.tree.root);
		controller.move("d2d4");
		const { tree } = controller.state;
		const [root, e4, e5] = tree.mainline();
		controller.first();
		expect(controller.state.current).toBe(root);
		controller.last();
		expect(controller.state.current).toBe(e5);
		controller.previous();
		expect(controller.state.current).toBe(e4);
		controller.sibling(1);
		expect(tree.sanAt(controller.state.current)).toBe("d4");
		controller.sibling(1);
		expect(controller.state.current).toBe(e4);
		controller.next();
		expect(controller.state.current).toBe(e5);
	});

	it("moves the cursor to the parent when its node is deleted", async () => {
		const { controller } = await setup();
		controller.move("e2e4");
		controller.move("e7e5");
		const [, e4] = controller.state.tree.mainline();
		if (e4 === undefined) throw new Error("e4 expected");
		const published: number[] = [];
		controller.subscribe((state) => published.push(state.current));
		published.length = 0;
		controller.deleteFrom(e4);
		expect(published).toEqual([controller.state.tree.root]);
		expect(controller.state.current).toBe(controller.state.tree.root);
		expect(controller.state.tree.mainline()).toHaveLength(1);
	});

	it("exports the line to a node as PGN without its variations", async () => {
		const { controller } = await setup();
		controller.move("e2e4");
		controller.move("e7e5");
		controller.previous();
		controller.move("c7c5");
		expect(controller.lineAsPgn(controller.state.current)).toContain("1. e4 c5 *");
		expect(controller.lineAsPgn(controller.state.current)).not.toContain("e5");
	});
});
