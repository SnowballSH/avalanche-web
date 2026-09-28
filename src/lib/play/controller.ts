import { parseUci } from "chessops/util";
import { type PovScore, whitePovAt } from "$lib/board/eval";
import { turnOf } from "$lib/board/moves";
import { adjudicate, drawOfferAccepted } from "$lib/chess/adjudicate";
import { positionFromFen } from "$lib/chess/fen";
import { exportPgn } from "$lib/chess/pgn";
import { createGameTree, IllegalMoveError, InvalidStartError } from "$lib/chess/tree";
import type { Color, GameResult, GameTree, NodeId } from "$lib/chess/types";
import { SearchAbortedError } from "$lib/engine/session";
import type {
	BestMove,
	BoundedSearch,
	EngineCapabilities,
	EngineLease,
	EngineScheduler,
	EngineStartOptions,
	Score,
	SearchHandle,
	UciMove,
	UciSession,
	Unsubscribe,
} from "$lib/engine/types";
import type { PinId } from "$lib/pins/types";
import { createClock } from "./clock";
import type {
	Clock,
	ClockFactory,
	ClockSnapshot,
	GameSetup,
	MonotonicNow,
	PlaySettings,
	PlayStore,
	SavedGame,
} from "./types";

export type PlayPhase = "idle" | "starting" | "playing" | "over";

export type EngineActivity =
	| { readonly kind: "idle" }
	| { readonly kind: "connecting" }
	| { readonly kind: "thinking" }
	| { readonly kind: "pondering" }
	| { readonly kind: "failed"; readonly message: string };

export interface PlayState {
	readonly phase: PlayPhase;
	readonly setup: GameSetup | null;
	readonly tree: GameTree;
	readonly revision: number;
	readonly clock: ClockSnapshot | null;
	readonly engine: EngineActivity;
	readonly result: GameResult | null;
	readonly premove: UciMove | null;
	readonly notice: string | null;
	readonly lastScore: PovScore | null;
}

export type EngineConnector = (pinId: PinId, options: EngineStartOptions) => Promise<UciSession>;

export interface PlayControllerDeps {
	readonly scheduler: EngineScheduler;
	readonly connect: EngineConnector;
	readonly now: MonotonicNow;
	readonly store?: PlayStore;
	readonly clockFactory?: ClockFactory;
	readonly random?: () => number;
	readonly wallClock?: () => Date;
	readonly saveFile?: (name: string, text: string) => void;
}

interface EngineSearch {
	readonly handle: SearchHandle;
	readonly done: Promise<{ readonly best: BestMove; readonly score: Score | null }>;
}

interface Ponder {
	readonly move: UciMove;
	readonly search: EngineSearch;
}

const PROMOTION_SUFFIX = "q";

const other = (side: Color): Color => (side === "white" ? "black" : "white");

const RESULT_TOKENS: Readonly<Record<GameResult["winner"], string>> = {
	white: "1-0",
	black: "0-1",
	draw: "1/2-1/2",
};

const TERMINATIONS: Readonly<Record<GameResult["reason"], string>> = {
	checkmate: "Normal",
	stalemate: "Normal",
	threefold: "Normal",
	"fifty-move": "Normal",
	insufficient: "Normal",
	flag: "Time forfeit",
	resign: "Normal",
	agreement: "Normal",
};

export const resultToken = (result: GameResult | null): string =>
	result ? RESULT_TOKENS[result.winner] : "*";

const engineErrorText = (error: unknown): string => {
	if (error instanceof SearchAbortedError) {
		return error.reason === "crashed"
			? "The engine crashed. Retry to restart it."
			: "The engine was stopped. Retry to restart it.";
	}
	return error instanceof Error ? error.message : String(error);
};

const secondsText = (ms: number): string => String(Math.round(ms / 1000));

const replay = (setup: GameSetup, moves: readonly UciMove[]): GameTree | null => {
	try {
		const tree = createGameTree(setup.settings.start);
		let node = tree.root;
		for (const move of moves) node = tree.addMove(node, move);
		return tree;
	} catch (error) {
		if (error instanceof IllegalMoveError || error instanceof InvalidStartError) return null;
		throw error;
	}
};

const lastNode = (tree: GameTree): NodeId => tree.mainline().at(-1) ?? tree.root;

const mainlineMoves = (tree: GameTree): UciMove[] =>
	tree
		.mainline()
		.slice(1)
		.map((id) => tree.node(id).move ?? "");

const isLegalIn = (tree: GameTree, uci: UciMove): boolean => {
	const move = parseUci(uci);
	return move !== undefined && positionFromFen(tree.fenAt(lastNode(tree))).isLegal(move);
};

export class PlayController {
	readonly #deps: PlayControllerDeps;
	readonly #clockFactory: ClockFactory;
	readonly #listeners = new Set<(state: PlayState) => void>();
	#state: PlayState;
	#lease: EngineLease | null = null;
	#session: UciSession | null = null;
	#clock: Clock | null = null;
	#search: EngineSearch | null = null;
	#ponder: Ponder | null = null;
	#engineScores: Score[] = [];
	#generation = 0;

	constructor(deps: PlayControllerDeps) {
		this.#deps = deps;
		this.#clockFactory = deps.clockFactory ?? createClock;
		this.#state = {
			phase: "idle",
			setup: null,
			tree: createGameTree({ kind: "standard" }),
			revision: 0,
			clock: null,
			engine: { kind: "idle" },
			result: null,
			premove: null,
			notice: null,
			lastScore: null,
		};
	}

	get state(): PlayState {
		return this.#state;
	}

	get result(): GameResult | null {
		return this.#state.result;
	}

	subscribe(listener: (state: PlayState) => void): Unsubscribe {
		this.#listeners.add(listener);
		listener(this.#state);
		return () => {
			this.#listeners.delete(listener);
		};
	}

	async start(settings: PlaySettings): Promise<void> {
		this.#halt();
		let tree: GameTree;
		try {
			tree = createGameTree(settings.start);
		} catch (error) {
			if (!(error instanceof InvalidStartError)) throw error;
			this.#update({ notice: error.message });
			return;
		}
		const userColor =
			settings.side === "random"
				? (this.#deps.random ?? Math.random)() < 0.5
					? "white"
					: "black"
				: settings.side;
		const setup: GameSetup = {
			settings,
			userColor,
			startedAt: (this.#deps.wallClock?.() ?? new Date()).toISOString(),
		};
		this.#clock = null;
		this.#engineScores = [];
		this.#update({
			phase: "starting",
			setup,
			tree,
			revision: this.#state.revision + 1,
			clock: null,
			result: null,
			premove: null,
			notice: null,
			lastScore: null,
		});
		await this.#boot(null);
	}

	resume(): boolean {
		const saved = this.#deps.store?.load();
		if (!saved) return false;
		const tree = replay(saved.setup, saved.moves);
		if (!tree) {
			this.#deps.store?.clear();
			return false;
		}
		this.#halt();
		this.#engineScores = [...saved.engineScores];
		const finished = saved.result !== null;
		this.#clock = finished ? this.#restoreClock(saved.setup, saved.clock) : null;
		this.#update({
			phase: finished ? "over" : "starting",
			setup: saved.setup,
			tree,
			revision: this.#state.revision + 1,
			clock: saved.clock,
			result: saved.result,
			premove: null,
			notice: null,
			lastScore: null,
		});
		if (!finished) void this.#boot(saved.clock);
		return true;
	}

	async retryEngine(): Promise<void> {
		const { phase, engine } = this.#state;
		if (engine.kind !== "failed") return;
		if (phase === "starting") {
			await this.#boot(this.#clock ? null : this.#state.clock);
			return;
		}
		if (phase !== "playing") return;
		const generation = this.#bump();
		try {
			this.#update({ engine: { kind: "connecting" } });
			const session = await this.#prepareSession();
			if (generation !== this.#generation) return;
			this.#session = session;
			this.#update({ engine: { kind: "idle" } });
			if (!this.#userToMove()) void this.#engineTurn(null);
		} catch (error) {
			if (generation === this.#generation) this.#failEngine(error);
		}
	}

	userMove(uci: UciMove): boolean {
		if (this.#state.phase !== "playing" || !this.#userToMove() || !this.#clock) return false;
		if (this.#checkFlag()) return false;
		const { tree } = this.#state;
		try {
			tree.addMove(lastNode(tree), uci);
		} catch (error) {
			if (error instanceof IllegalMoveError) return false;
			throw error;
		}
		this.#clock.press();
		this.#update({ revision: this.#state.revision + 1, premove: null });
		if (this.#adjudicate()) return true;
		this.#persist();
		void this.#engineTurn(uci);
		return true;
	}

	premove(uci: UciMove | null): void {
		if (uci !== null && (this.#state.phase !== "playing" || this.#userToMove())) return;
		this.#update({ premove: uci });
	}

	resign(): void {
		const setup = this.#state.setup;
		if (!setup || !this.#inGame()) return;
		this.#finish({ winner: other(setup.userColor), reason: "resign" });
	}

	offerDraw(): boolean {
		if (this.#state.phase !== "playing") return false;
		if (drawOfferAccepted(this.#engineScores)) {
			this.#finish({ winner: "draw", reason: "agreement" });
			return true;
		}
		this.#update({ notice: "Avalanche declines the draw." });
		return false;
	}

	canTakeback(): boolean {
		const { phase, setup, tree } = this.#state;
		if (phase !== "playing" || !setup) return false;
		return tree
			.mainline()
			.slice(1)
			.some((id) => turnOf(tree.fenAt(tree.node(id).parent ?? tree.root)) === setup.userColor);
	}

	takeback(): boolean {
		if (!this.canTakeback() || !this.#clock) return false;
		const { tree, setup } = this.#state;
		if (!setup) return false;
		this.#halt();
		const line = tree.mainline();
		const plies = this.#userToMove() ? 2 : 1;
		const removed = line.slice(-plies);
		const engineMoves = removed.filter(
			(id) => turnOf(tree.fenAt(tree.node(id).parent ?? tree.root)) !== setup.userColor,
		).length;
		const first = removed[0];
		if (first === undefined) return false;
		tree.deleteFrom(first);
		this.#engineScores.splice(this.#engineScores.length - engineMoves, engineMoves);
		this.#clock.start(setup.userColor);
		this.#update({
			revision: this.#state.revision + 1,
			premove: null,
			notice: null,
			engine: this.#state.engine.kind === "failed" ? this.#state.engine : { kind: "idle" },
		});
		this.#persist();
		return true;
	}

	tick(): void {
		if (this.#state.phase === "playing") this.#checkFlag();
	}

	remaining(side: Color): number | null {
		if (this.#clock) return this.#clock.remaining(side, this.#deps.now());
		const snapshot = this.#state.clock;
		if (!snapshot) return null;
		return side === "white" ? snapshot.whiteMs : snapshot.blackMs;
	}

	save(): void {
		if (this.#state.phase === "playing" || this.#state.phase === "over") this.#persist();
	}

	dismissNotice(): void {
		this.#update({ notice: null });
	}

	pgn(): string {
		const { tree, setup, result } = this.#state;
		return exportPgn(tree, {
			evals: false,
			headers: setup ? this.#headers(setup, result) : new Map(),
		});
	}

	toAnalysis(): string {
		return this.pgn();
	}

	pgnFileName(): string {
		const date = this.#state.setup?.startedAt.slice(0, 10) ?? "game";
		return `avalanche-${date}.pgn`;
	}

	downloadPgn(): void {
		this.#deps.saveFile?.(this.pgnFileName(), this.pgn());
	}

	dispose(): void {
		if (this.#state.phase === "playing") this.#persist();
		this.#halt();
		this.#releaseLease();
		this.#listeners.clear();
	}

	#update(patch: Partial<PlayState>): void {
		this.#state = { ...this.#state, ...patch };
		for (const listener of this.#listeners) listener(this.#state);
	}

	#bump(): number {
		this.#generation += 1;
		return this.#generation;
	}

	#halt(): void {
		this.#bump();
		this.#search?.handle.stop();
		this.#search = null;
		this.#ponder?.search.handle.stop();
		this.#ponder = null;
	}

	#inGame(): boolean {
		return this.#state.phase === "playing" || this.#state.phase === "starting";
	}

	#userToMove(): boolean {
		const { tree, setup } = this.#state;
		return setup !== null && turnOf(tree.fenAt(lastNode(tree))) === setup.userColor;
	}

	#restoreClock(setup: GameSetup, snapshot: ClockSnapshot): Clock {
		return this.#clockFactory({
			...setup.settings.timeControl,
			now: this.#deps.now,
			restore: snapshot,
		});
	}

	#acquireLease(): void {
		this.#lease ??= this.#deps.scheduler.acquire("play");
	}

	#releaseLease(): void {
		if (this.#lease) this.#deps.scheduler.release(this.#lease);
		this.#lease = null;
	}

	async #boot(restore: ClockSnapshot | null): Promise<void> {
		const generation = this.#bump();
		const setup = this.#state.setup;
		if (!setup) return;
		this.#acquireLease();
		this.#update({ engine: { kind: "connecting" } });
		try {
			const session = await this.#prepareSession();
			if (generation !== this.#generation) return;
			this.#session = session;
		} catch (error) {
			if (generation === this.#generation) this.#failEngine(error);
			return;
		}
		const { tree } = this.#state;
		const clock = restore
			? this.#restoreClock(setup, restore)
			: this.#clockFactory({ ...setup.settings.timeControl, now: this.#deps.now });
		if (clock.running === null) clock.start(turnOf(tree.fenAt(lastNode(tree))));
		this.#clock = clock;
		this.#update({ phase: "playing", engine: { kind: "idle" } });
		if (this.#adjudicate()) return;
		this.#persist();
		if (!this.#userToMove()) void this.#engineTurn(null);
	}

	async #prepareSession(): Promise<UciSession> {
		const setup = this.#state.setup;
		if (!setup) throw new Error("No game is set up");
		const { settings } = setup;
		let session = await this.#deps.connect(settings.pinId, { hashMb: settings.hashMb });
		let capabilities = session.capabilities ?? (await session.handshake());
		if (settings.threads !== null && settings.threads > 1 && capabilities.threadsMax > 1) {
			session = await this.#deps.connect(settings.pinId, {
				hashMb: settings.hashMb,
				threads: Math.min(settings.threads, capabilities.threadsMax),
			});
			capabilities = session.capabilities ?? (await session.handshake());
		}
		await this.#configure(session, capabilities, settings);
		return session;
	}

	async #configure(
		session: UciSession,
		capabilities: EngineCapabilities,
		settings: PlaySettings,
	): Promise<void> {
		const chess960 = settings.start.kind === "frc";
		if (chess960 && !capabilities.supportsChess960) {
			throw new Error("This engine version does not support Chess960");
		}
		const { strength } = settings;
		const eloRange = capabilities.eloRange;
		if (strength.kind === "elo" && (!capabilities.supportsLimitStrength || !eloRange)) {
			throw new Error("This engine version cannot limit its strength");
		}
		await session.newGame();
		if (capabilities.multiPvMax > 1) await session.setOption("MultiPV", 1);
		if (capabilities.supportsChess960) await session.setOption("UCI_Chess960", chess960);
		if (capabilities.supportsLimitStrength) {
			await session.setOption("UCI_LimitStrength", strength.kind === "elo");
		}
		if (eloRange) {
			const elo = strength.kind === "elo" ? strength.elo : eloRange.default;
			await session.setOption("UCI_Elo", Math.min(eloRange.max, Math.max(eloRange.min, elo)));
		}
		if (capabilities.options.has("Ponder")) await session.setOption("Ponder", settings.ponder);
	}

	#limits(ponder: boolean): BoundedSearch & { readonly ponder?: boolean } {
		const setup = this.#state.setup;
		const clock = this.#clock;
		if (!setup || !clock) throw new Error("No game is running");
		const now = this.#deps.now();
		const { incrementMs } = setup.settings.timeControl;
		const limit = setup.settings.engineLimit;
		return {
			...(limit ? { [limit.kind]: limit.value } : {}),
			wtime: Math.floor(clock.remaining("white", now)),
			btime: Math.floor(clock.remaining("black", now)),
			winc: incrementMs,
			binc: incrementMs,
			...(ponder ? { ponder: true } : {}),
		};
	}

	#go(session: UciSession, ponder: boolean): EngineSearch {
		const handle = session.search(this.#limits(ponder));
		const done = (async () => {
			let score: Score | null = null;
			for await (const info of handle.info) if (info.multipv === 1) score = info.score;
			const best = await handle.result;
			return { best, score };
		})();
		done.catch(() => undefined);
		return { handle, done };
	}

	async #engineTurn(userMove: UciMove | null): Promise<void> {
		const generation = this.#bump();
		const session = this.#session;
		if (!session) return;
		const ponder = this.#ponder;
		this.#ponder = null;
		try {
			let search: EngineSearch;
			if (ponder && ponder.move === userMove) {
				ponder.search.handle.ponderhit();
				search = ponder.search;
			} else {
				ponder?.search.handle.stop();
				const { tree } = this.#state;
				await session.position(tree.fenAt(tree.root), mainlineMoves(tree));
				if (generation !== this.#generation) return;
				search = this.#go(session, false);
			}
			this.#search = search;
			this.#update({ engine: { kind: "thinking" } });
			const { best, score } = await search.done;
			if (generation !== this.#generation) return;
			this.#search = null;
			this.#playEngineMove(best, score);
		} catch (error) {
			if (generation === this.#generation) this.#failEngine(error);
		}
	}

	#playEngineMove(best: BestMove, score: Score | null): void {
		if (this.#checkFlag() || !this.#clock) return;
		const { tree } = this.#state;
		const before = tree.fenAt(lastNode(tree));
		if (best.move === null) {
			this.#failEngine(new Error("The engine returned no move"));
			return;
		}
		try {
			tree.addMove(lastNode(tree), best.move);
		} catch (error) {
			if (!(error instanceof IllegalMoveError)) throw error;
			this.#failEngine(new Error(`The engine played an illegal move (${best.move})`));
			return;
		}
		this.#clock.press();
		if (score) this.#engineScores.push(score);
		this.#update({
			revision: this.#state.revision + 1,
			engine: { kind: "idle" },
			lastScore: score ? whitePovAt(before, score) : this.#state.lastScore,
		});
		if (this.#adjudicate()) return;
		this.#persist();
		if (this.#playPremove()) return;
		const setup = this.#state.setup;
		if (setup?.settings.ponder && best.ponder && isLegalIn(tree, best.ponder)) {
			void this.#startPonder(best.ponder);
		}
	}

	#playPremove(): boolean {
		const premove = this.#state.premove;
		if (premove === null) return false;
		this.#update({ premove: null });
		return (
			this.userMove(premove) ||
			(premove.length === 4 && this.userMove(`${premove}${PROMOTION_SUFFIX}`))
		);
	}

	async #startPonder(move: UciMove): Promise<void> {
		const generation = this.#generation;
		const session = this.#session;
		if (!session) return;
		const { tree } = this.#state;
		try {
			await session.position(tree.fenAt(tree.root), [...mainlineMoves(tree), move]);
			if (generation !== this.#generation || this.#state.phase !== "playing") return;
			this.#ponder = { move, search: this.#go(session, true) };
			this.#update({ engine: { kind: "pondering" } });
		} catch (error) {
			if (generation === this.#generation) this.#failEngine(error);
		}
	}

	#checkFlag(): boolean {
		const flagged = this.#clock?.flagged(this.#deps.now()) ?? null;
		if (flagged === null) return false;
		this.#finish({ winner: other(flagged), reason: "flag" });
		return true;
	}

	#adjudicate(): boolean {
		const { tree } = this.#state;
		const line = tree.mainline();
		const history = line.slice(0, -1).map((id) => tree.fenAt(id));
		const result = adjudicate(tree.fenAt(lastNode(tree)), history);
		if (!result) return false;
		this.#finish(result);
		return true;
	}

	#finish(result: GameResult): void {
		this.#halt();
		this.#clock?.stop(this.#deps.now());
		this.#update({
			phase: "over",
			result,
			premove: null,
			engine: { kind: "idle" },
			clock: this.#clock?.snapshot(this.#deps.now()) ?? this.#state.clock,
		});
		this.#persist();
		this.#releaseLease();
	}

	#failEngine(error: unknown): void {
		this.#search = null;
		this.#ponder = null;
		this.#session = null;
		this.#update({ engine: { kind: "failed", message: engineErrorText(error) } });
	}

	#persist(): void {
		const { setup, tree, result } = this.#state;
		const store = this.#deps.store;
		if (!setup || !store) return;
		const clock = this.#clock?.snapshot(this.#deps.now()) ?? this.#state.clock;
		if (!clock) return;
		const game: SavedGame = {
			version: 1,
			setup,
			moves: mainlineMoves(tree),
			clock,
			engineScores: [...this.#engineScores],
			result,
		};
		store.save(game);
		this.#update({ clock });
	}

	#headers(setup: GameSetup, result: GameResult | null): Map<string, string> {
		const { settings, userColor, startedAt } = setup;
		const engineName = `Avalanche ${settings.pinId}`;
		const headers = new Map<string, string>([
			["Event", "Avalanche Web game"],
			["Site", "?"],
			["Date", startedAt.slice(0, 10).replaceAll("-", ".")],
			["Round", "-"],
			["White", userColor === "white" ? "You" : engineName],
			["Black", userColor === "black" ? "You" : engineName],
			["Result", resultToken(result)],
			[
				"TimeControl",
				`${secondsText(settings.timeControl.baseMs)}+${secondsText(settings.timeControl.incrementMs)}`,
			],
		]);
		if (settings.strength.kind === "elo") {
			headers.set(userColor === "white" ? "BlackElo" : "WhiteElo", String(settings.strength.elo));
		}
		if (result) headers.set("Termination", TERMINATIONS[result.reason]);
		return headers;
	}
}
