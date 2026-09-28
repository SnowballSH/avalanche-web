import { makeFen } from "chessops/fen";
import { makeSanAndPlay } from "chessops/san";
import { parseUci } from "chessops/util";
import { type PovScore, whitePovAt } from "$lib/board/eval";
import { parseFen, positionFromFen } from "$lib/chess/fen";
import { exportPgn } from "$lib/chess/pgn";
import { createGameTree, IllegalMoveError, InvalidStartError } from "$lib/chess/tree";
import type {
	GameTree,
	ImportedGame,
	ImportResult,
	NodeId,
	San,
	StartPosition,
} from "$lib/chess/types";
import { SearchAbortedError, SessionAbortedError } from "$lib/engine/session";
import type {
	EngineLease,
	EngineScheduler,
	Fen,
	LeaseState,
	SearchHandle,
	SearchInfo,
	UciMove,
	UciSession,
	Unsubscribe,
} from "$lib/engine/types";
import { fenFromHash } from "./hash-link";

export const MULTI_PV_MIN = 1;

export const MULTI_PV_MAX = 5;

export type EngineStatus =
	| { readonly kind: "off" }
	| { readonly kind: "starting" }
	| { readonly kind: "running" }
	| { readonly kind: "suspended" }
	| { readonly kind: "failed"; readonly message: string };

export interface EngineLine {
	readonly node: NodeId;
	readonly multipv: number;
	readonly depth: number;
	readonly seldepth: number | undefined;
	readonly nodes: number | undefined;
	readonly nps: number | undefined;
	readonly score: PovScore;
	readonly pv: readonly UciMove[];
	readonly san: readonly San[];
}

export interface AnalysisNotice {
	readonly kind: "error" | "info";
	readonly text: string;
}

export interface AnalysisState {
	readonly tree: GameTree;
	readonly revision: number;
	readonly current: NodeId;
	readonly engine: EngineStatus;
	readonly multiPv: number;
	readonly lines: readonly EngineLine[];
	readonly notice: AnalysisNotice | null;
	readonly headers: ReadonlyMap<string, string>;
}

export type AnalysisSource = StartPosition | ImportedGame;

export interface AnalysisControllerDeps {
	readonly scheduler: EngineScheduler;
	readonly connect: () => Promise<UciSession>;
	readonly cancelConnect: () => void;
}

interface Configuration {
	readonly session: UciSession;
	readonly multiPv: number;
	readonly chess960: boolean;
}

const errorMessage = (error: unknown): string => {
	if (error instanceof SearchAbortedError || error instanceof SessionAbortedError) {
		return error.reason === "crashed"
			? "The engine crashed. Switch it on again to restart it."
			: "The engine was stopped. Switch it on again to restart it.";
	}
	return error instanceof Error ? error.message : String(error);
};

const isStartPosition = (source: AnalysisSource): source is StartPosition => "kind" in source;

const buildTree = (source: AnalysisSource): ImportResult<GameTree> => {
	if (!isStartPosition(source)) return source.tree();
	try {
		return { ok: true, value: createGameTree(source) };
	} catch (error) {
		if (error instanceof InvalidStartError) return { ok: false, error: error.error };
		throw error;
	}
};

const movesTo = (tree: GameTree, id: NodeId): UciMove[] =>
	tree
		.pathTo(id)
		.slice(1)
		.map((nodeId) => tree.node(nodeId).move ?? "");

export const pvSan = (fen: Fen, pv: readonly UciMove[]): San[] => {
	const position = positionFromFen(fen);
	const sans: San[] = [];
	for (const uci of pv) {
		const move = parseUci(uci);
		if (!move || !position.isLegal(move)) break;
		sans.push(makeSanAndPlay(position, move));
	}
	return sans;
};

export const fenAfter = (fen: Fen, pv: readonly UciMove[]): Fen => {
	const position = positionFromFen(fen);
	for (const uci of pv) {
		const move = parseUci(uci);
		if (!move || !position.isLegal(move)) break;
		position.play(move);
	}
	return makeFen(position.toSetup());
};

export const clampMultiPv = (value: number): number =>
	Math.min(MULTI_PV_MAX, Math.max(MULTI_PV_MIN, Math.round(value)));

export class AnalysisController {
	readonly #scheduler: EngineScheduler;
	readonly #connect: () => Promise<UciSession>;
	readonly #cancelConnect: () => void;
	readonly #listeners = new Set<(state: AnalysisState) => void>();
	readonly #lines = new Map<number, EngineLine>();
	#state: AnalysisState;
	#lease: EngineLease | null = null;
	#leaseUnsubscribe: Unsubscribe | null = null;
	#engineOn = false;
	#session: Promise<UciSession> | null = null;
	#configured: Configuration | null = null;
	#search: SearchHandle | null = null;
	#generation = 0;

	constructor(deps: AnalysisControllerDeps) {
		this.#scheduler = deps.scheduler;
		this.#connect = deps.connect;
		this.#cancelConnect = deps.cancelConnect;
		const tree = createGameTree({ kind: "standard" });
		this.#state = {
			tree,
			revision: 0,
			current: tree.root,
			engine: { kind: "off" },
			multiPv: MULTI_PV_MIN,
			lines: [],
			notice: null,
			headers: new Map(),
		};
	}

	get state(): AnalysisState {
		return this.#state;
	}

	subscribe(listener: (state: AnalysisState) => void): Unsubscribe {
		this.#listeners.add(listener);
		listener(this.#state);
		return () => {
			this.#listeners.delete(listener);
		};
	}

	async setEngine(on: boolean): Promise<void> {
		if (!on) {
			this.#engineOn = false;
			this.#cancelConnect();
			this.#halt();
			this.#releaseLease();
			this.#forgetSession();
			this.#update({ engine: { kind: "off" }, lines: [] });
			return;
		}
		this.#engineOn = true;
		const lease = this.#lease ?? this.#acquireLease();
		if (lease.state === "active") await this.#restart();
		else this.#update({ engine: { kind: "suspended" } });
	}

	async reconnect(): Promise<void> {
		this.#halt();
		this.#forgetSession();
		if (this.#analysing()) await this.#restart();
	}

	async setMultiPv(value: number): Promise<void> {
		const multiPv = clampMultiPv(value);
		for (const rank of this.#lines.keys()) if (rank > multiPv) this.#lines.delete(rank);
		this.#update({ multiPv, lines: this.#sortedLines() });
		if (this.#analysing()) await this.#restart();
	}

	goto(id: NodeId): void {
		if (id === this.#state.current) return;
		this.#state.tree.node(id);
		this.#lines.clear();
		this.#update({ current: id, lines: [] });
		if (this.#analysing()) void this.#restart();
	}

	move(uci: UciMove): boolean {
		let child: NodeId;
		try {
			child = this.#state.tree.addMove(this.#state.current, uci);
		} catch (error) {
			if (error instanceof IllegalMoveError) return false;
			throw error;
		}
		this.#touch();
		this.goto(child);
		return true;
	}

	playPv(multipv: number, plies: number): void {
		const line = this.#state.lines.find((candidate) => candidate.multipv === multipv);
		if (!line) return;
		const { tree } = this.#state;
		let id = line.node;
		for (const uci of line.pv.slice(0, Math.min(plies, line.san.length))) {
			id = tree.addMove(id, uci);
		}
		this.#touch();
		this.goto(id);
	}

	load(source: AnalysisSource): ImportResult<GameTree> {
		const built = buildTree(source);
		if (!built.ok) return built;
		const tree = built.value;
		this.#lines.clear();
		this.#update({
			tree,
			revision: this.#state.revision + 1,
			current: tree.root,
			lines: [],
			notice: null,
			headers: isStartPosition(source) ? new Map() : source.headers,
		});
		if (this.#analysing()) void this.#restart();
		return built;
	}

	loadHash(hash: string): void {
		const text = fenFromHash(hash);
		if (text === null) return;
		const parsed = parseFen(text);
		if (!parsed.ok) {
			this.#update({ notice: { kind: "error", text: parsed.error.message } });
			return;
		}
		const { fen } = parsed.value;
		const loaded = this.load({ kind: "fen", fen });
		if (!loaded.ok) {
			this.#update({ notice: { kind: "error", text: loaded.error.message } });
		} else if (fen !== text.trim()) {
			this.#update({ notice: { kind: "info", text: `Loaded as ${fen}` } });
		}
	}

	dismissNotice(): void {
		this.#update({ notice: null });
	}

	next(): void {
		const child = this.#state.tree.children(this.#state.current)[0];
		if (child !== undefined) this.goto(child);
	}

	previous(): void {
		const parent = this.#state.tree.node(this.#state.current).parent;
		if (parent !== null) this.goto(parent);
	}

	first(): void {
		this.goto(this.#state.tree.root);
	}

	last(): void {
		const { tree } = this.#state;
		let id = this.#state.current;
		for (let child = tree.children(id)[0]; child !== undefined; child = tree.children(id)[0]) {
			id = child;
		}
		this.goto(id);
	}

	sibling(delta: number): void {
		const { tree, current } = this.#state;
		const parent = tree.node(current).parent;
		if (parent === null) return;
		const siblings = tree.children(parent);
		const index = siblings.indexOf(current);
		const target = siblings[(index + delta + siblings.length) % siblings.length];
		if (target !== undefined) this.goto(target);
	}

	promote(id: NodeId): void {
		this.#state.tree.promote(id);
		this.#touch();
	}

	deleteFrom(id: NodeId): void {
		const { tree, current } = this.#state;
		const parent = tree.node(id).parent;
		if (parent === null) return;
		const cursorRemoved = tree.pathTo(current).includes(id);
		tree.deleteFrom(id);
		if (!cursorRemoved) {
			this.#touch();
			return;
		}
		this.#lines.clear();
		this.#update({ revision: this.#state.revision + 1, current: parent, lines: [] });
		if (this.#analysing()) void this.#restart();
	}

	lineAsPgn(id: NodeId): string {
		const { tree } = this.#state;
		const line = createGameTree(tree.start);
		let cursor = line.root;
		for (const uci of movesTo(tree, id)) cursor = line.addMove(cursor, uci);
		return exportPgn(line, { evals: false });
	}

	exportPgn(evals: boolean): string {
		return exportPgn(this.#state.tree, { evals, headers: this.#state.headers });
	}

	dispose(): void {
		void this.setEngine(false);
		this.#listeners.clear();
	}

	#update(patch: Partial<AnalysisState>): void {
		this.#state = { ...this.#state, ...patch };
		for (const listener of this.#listeners) listener(this.#state);
	}

	#touch(): void {
		this.#update({ revision: this.#state.revision + 1 });
	}

	#analysing(): boolean {
		return this.#engineOn && this.#lease?.state === "active";
	}

	#acquireLease(): EngineLease {
		const lease = this.#scheduler.acquire("analysis");
		this.#lease = lease;
		this.#leaseUnsubscribe = lease.onStateChange((state) => this.#onLeaseState(state));
		return lease;
	}

	#releaseLease(): void {
		this.#leaseUnsubscribe?.();
		this.#leaseUnsubscribe = null;
		if (this.#lease) this.#scheduler.release(this.#lease);
		this.#lease = null;
	}

	#onLeaseState(state: LeaseState): void {
		if (state === "suspended") {
			this.#halt();
			this.#forgetSession();
			this.#lines.clear();
			this.#update({ engine: { kind: "suspended" }, lines: [] });
		} else if (state === "active" && this.#engineOn) {
			void this.#restart();
		}
	}

	#halt(): void {
		this.#generation += 1;
		this.#search?.stop();
		this.#search = null;
	}

	#forgetSession(): void {
		this.#session = null;
		this.#configured = null;
	}

	#ensureSession(): Promise<UciSession> {
		this.#session ??= this.#connect();
		return this.#session;
	}

	async #restart(): Promise<void> {
		this.#halt();
		const generation = this.#generation;
		this.#lines.clear();
		this.#update({
			lines: [],
			...(this.#state.engine.kind === "running" ? {} : { engine: { kind: "starting" } }),
		});
		try {
			const session = await this.#ensureSession();
			if (generation !== this.#generation) return;
			if (!(await this.#configure(session, generation))) return;
			const { tree, current } = this.#state;
			await session.position(tree.fenAt(tree.root), movesTo(tree, current));
			if (generation !== this.#generation) return;
			const handle = session.search({ infinite: true });
			this.#search = handle;
			this.#update({ engine: { kind: "running" } });
			void this.#consume(handle, generation, tree, current);
		} catch (error) {
			if (generation === this.#generation) this.#fail(error);
		}
	}

	async #configure(session: UciSession, generation: number): Promise<boolean> {
		const current = () => generation === this.#generation;
		const chess960 = this.#state.tree.start.kind === "frc";
		const { multiPv } = this.#state;
		const done = this.#configured;
		if (done?.session === session && done.multiPv === multiPv && done.chess960 === chess960) {
			return true;
		}
		const capabilities = session.capabilities ?? (await session.handshake());
		if (!current()) return false;
		if (chess960 && !capabilities.supportsChess960) {
			throw new Error("This engine version does not support Chess960");
		}
		if (capabilities.multiPvMax > 1) {
			await session.setOption("MultiPV", Math.min(multiPv, capabilities.multiPvMax));
			if (!current()) return false;
		}
		if (capabilities.supportsChess960) {
			await session.setOption("UCI_Chess960", chess960);
			if (!current()) return false;
		}
		if (capabilities.supportsLimitStrength) {
			await session.setOption("UCI_LimitStrength", false);
			if (!current()) return false;
		}
		this.#configured = { session, multiPv, chess960 };
		return true;
	}

	async #consume(
		handle: SearchHandle,
		generation: number,
		tree: GameTree,
		node: NodeId,
	): Promise<void> {
		try {
			for await (const info of handle.info) {
				if (generation !== this.#generation) break;
				this.#receive(info, tree, node);
			}
			await handle.result;
		} catch (error) {
			if (generation === this.#generation) this.#fail(error);
		}
	}

	#receive(info: SearchInfo, tree: GameTree, node: NodeId): void {
		if (info.multipv > this.#state.multiPv) return;
		const fen = tree.fenAt(node);
		this.#lines.set(info.multipv, {
			node,
			multipv: info.multipv,
			depth: info.depth,
			seldepth: info.seldepth,
			nodes: info.nodes,
			nps: info.nps,
			score: whitePovAt(fen, info.score),
			pv: info.pv,
			san: pvSan(fen, info.pv),
		});
		const stored = tree.node(node).eval;
		const exact = info.multipv === 1 && info.score.bound === undefined;
		const deeper = exact && (stored === null || stored.depth <= info.depth);
		if (deeper) tree.setEval(node, info);
		this.#update({
			lines: this.#sortedLines(),
			revision: this.#state.revision + (deeper ? 1 : 0),
		});
	}

	#sortedLines(): EngineLine[] {
		return [...this.#lines.values()].sort((a, b) => a.multipv - b.multipv);
	}

	#fail(error: unknown): void {
		this.#search = null;
		this.#forgetSession();
		this.#lines.clear();
		this.#update({ engine: { kind: "failed", message: errorMessage(error) }, lines: [] });
	}
}
