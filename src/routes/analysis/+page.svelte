<script lang="ts">
import { Button, Callout, Panel } from "foundationui/svelte";
import { onMount } from "svelte";
import { AnalysisController } from "$lib/analysis/controller";
import EnginePanel from "$lib/analysis/EnginePanel.svelte";
import ImportExport from "$lib/analysis/ImportExport.svelte";
import MoveTree from "$lib/analysis/MoveTree.svelte";
import Board from "$lib/board/Board.svelte";
import EvalBar from "$lib/board/EvalBar.svelte";
import EvalGraph from "$lib/board/EvalGraph.svelte";
import { type PovScore, whitePovAt } from "$lib/board/eval";
import { legalDests, turnOf } from "$lib/board/moves";
import { bestMoveArrow } from "$lib/board/shapes";
import { positionFromFen } from "$lib/chess/fen";
import { importPgn } from "$lib/chess/pgn";
import type { Color, StartPosition } from "$lib/chess/types";
import { hashChoices as hashChoicesFor } from "$lib/engine/memory";
import type { EngineScheduler, UciSession } from "$lib/engine/types";
import { getDefaultPin } from "$lib/pins/default-pin";
import type { PinEntry, PinId } from "$lib/pins/types";
import { takeAnalysisHandoff } from "$lib/shared/analysis-handoff";
import {
	browserEngineRuntime,
	defaultHashMb,
	deviceMemoryGb,
	engineErrorMessage,
	isCrossOriginIsolated,
} from "$lib/shared/engine-runtime";
import StartPositionPicker from "$lib/shared/StartPositionPicker.svelte";

const scheduler: EngineScheduler = {
	acquire: (owner) => browserEngineRuntime().scheduler.acquire(owner),
	release: (lease) => browserEngineRuntime().scheduler.release(lease),
};

let isolated = $state(true);
let pins = $state.raw<readonly PinEntry[]>([]);
let pinId = $state<PinId | null>(null);
let hashChoices = $state.raw<readonly number[]>([]);
let hashMb = $state(0);
let effectiveHashMb = $state<number | null>(null);
let hashNotice = $state<string | null>(null);
let threadsMax = $state(1);
let threads = $state(1);
let download = $state<number | null>(null);
let orientation = $state<Color>("white");
let status = $state<string | null>(null);

const startOptions = () => (threadsMax > 1 ? { hashMb, threads } : { hashMb });

const connect = async (): Promise<UciSession> => {
	const runtime = browserEngineRuntime();
	try {
		const catalogue = await runtime.catalogue();
		pins = catalogue.pins;
		const pin = catalogue.pins.find((entry) => entry.id === pinId) ?? getDefaultPin(catalogue);
		if (!pin) throw new Error("The engine catalogue lists no engine versions");
		pinId = pin.id;
		download = 0;
		await runtime.pins.download(pin, (fraction) => {
			download = fraction;
		});
		download = null;
		const session = await runtime.sessions.ensure(pin, startOptions());
		effectiveHashMb = runtime.sessions.host.effectiveHashMb;
		threadsMax = session.capabilities?.threadsMax ?? 1;
		return session;
	} catch (error) {
		throw new Error(engineErrorMessage(error));
	} finally {
		download = null;
	}
};

const controller = new AnalysisController({ scheduler, connect });

let view = $state.raw(controller.state);

const tree = $derived(view.tree);
const node = $derived.by(() => {
	void view.revision;
	return tree.node(view.current);
});
const fen = $derived(node.fen);
const chess960 = $derived(tree.start.kind === "frc");
const movable = $derived({ color: turnOf(fen), dests: legalDests(fen, chess960) });
const inCheck = $derived(positionFromFen(fen).isCheck());
const bestLine = $derived(view.lines[0]);
const shapes = $derived.by(() => {
	const arrow = bestLine ? bestMoveArrow(bestLine.pv) : undefined;
	return arrow ? [arrow] : [];
});
const score = $derived<PovScore | null>(
	bestLine?.score ?? (node.eval ? whitePovAt(fen, node.eval.score) : null),
);
const mainline = $derived.by(() => {
	void view.revision;
	return tree.mainline();
});
const graphScores = $derived(
	mainline.map((id) => {
		const entry = tree.node(id);
		return entry.eval ? whitePovAt(entry.fen, entry.eval.score) : null;
	}),
);
const graphCursor = $derived.by(() => {
	const index = mainline.indexOf(view.current);
	return index === -1 ? Math.min(node.ply, mainline.length - 1) : index;
});

const restartWith = (change: () => void) => {
	change();
	void controller.reconnect();
};

const copy = async (text: string, what: string) => {
	try {
		await navigator.clipboard.writeText(text);
		status = `${what} copied`;
	} catch {
		status = `Could not copy the ${what}`;
	}
};

const loadStart = (start: StartPosition) => {
	const loaded = controller.load(start);
	status = loaded.ok ? "New position set up" : loaded.error.message;
};

const loadHandoff = () => {
	const pgn = takeAnalysisHandoff();
	if (pgn === null) return;
	const imported = importPgn(pgn);
	const game = imported.ok ? imported.value[0] : undefined;
	if (!game) {
		status = imported.ok ? "The handed-over game was empty" : imported.error.message;
		return;
	}
	const loaded = controller.load(game);
	if (!loaded.ok) {
		status = loaded.error.message;
		return;
	}
	controller.last();
	status = "Game loaded from Play";
};

const KEY_ACTIONS: Readonly<Record<string, () => void>> = {
	ArrowLeft: () => controller.previous(),
	ArrowRight: () => controller.next(),
	ArrowUp: () => controller.sibling(-1),
	ArrowDown: () => controller.sibling(1),
	Home: () => controller.first(),
	End: () => controller.last(),
};

const onKey = (event: KeyboardEvent) => {
	if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
	const target = event.target instanceof Element ? event.target : null;
	if (target?.closest("input, textarea, select, [contenteditable], [role=dialog]")) return;
	const action = KEY_ACTIONS[event.key];
	if (!action) return;
	event.preventDefault();
	action();
};

const selectGraphPly = (index: number) => {
	const id = mainline[index];
	if (id !== undefined) controller.goto(id);
};

onMount(() => {
	isolated = isCrossOriginIsolated();
	hashChoices = hashChoicesFor(deviceMemoryGb());
	hashMb = defaultHashMb();
	const unsubscribe = controller.subscribe((state) => {
		view = state;
	});
	const loadHash = () => controller.loadHash(window.location.hash);
	loadHash();
	loadHandoff();
	window.addEventListener("hashchange", loadHash);
	let stopNotices = () => {};
	if (isolated) {
		const runtime = browserEngineRuntime();
		stopNotices = runtime.sessions.host.onNotice((notice) => {
			if (notice.kind !== "hash-allocation-failed") return;
			effectiveHashMb = notice.effectiveMb;
			hashNotice = `${notice.requestedMb} MB of Hash could not be allocated; the engine is using ${notice.effectiveMb} MB.`;
		});
		runtime
			.catalogue()
			.then((catalogue) => {
				pins = catalogue.pins;
				pinId ??= getDefaultPin(catalogue)?.id ?? null;
			})
			.catch(() => undefined);
	}
	return () => {
		window.removeEventListener("hashchange", loadHash);
		stopNotices();
		unsubscribe();
		controller.dispose();
	};
});
</script>

<svelte:head>
	<title>Analysis · Avalanche</title>
</svelte:head>

<svelte:window onkeydown={onKey} />

<div class="analysis">
	<h1 class="sr-only">Analysis</h1>

	{#if view.notice}
		<Callout
			tone={view.notice.kind === "error" ? "warn" : "info"}
			role={view.notice.kind === "error" ? "alert" : "status"}
			class="notice"
			data-testid="analysis-notice"
		>
			<span>{view.notice.text}</span>
			<Button size="sm" variant="ghost" onclick={() => controller.dismissNotice()}>Dismiss</Button>
		</Callout>
	{/if}

	<div class="main">
		<div class="stage">
			<EvalBar {score} {orientation} class="bar" />
			<Board
				{fen}
				{orientation}
				{movable}
				lastMove={node.move}
				check={inCheck}
				{shapes}
				{chess960}
				onmove={(uci) => controller.move(uci)}
				class="board-slot"
			/>
		</div>
		<div class="controls">
			<Button size="sm" variant="secondary" aria-label="First move" onclick={() => controller.first()}>
				⏮
			</Button>
			<Button
				size="sm"
				variant="secondary"
				aria-label="Previous move"
				onclick={() => controller.previous()}
			>
				◀
			</Button>
			<Button size="sm" variant="secondary" aria-label="Next move" onclick={() => controller.next()}>
				▶
			</Button>
			<Button size="sm" variant="secondary" aria-label="Last move" onclick={() => controller.last()}>
				⏭
			</Button>
			<Button
				size="sm"
				variant="secondary"
				onclick={() => (orientation = orientation === "white" ? "black" : "white")}
			>
				Flip
			</Button>
		</div>
		<label class="fen-field">
			<span class="text-xs text-ink-muted">FEN</span>
			<input class="fen" readonly value={fen} data-testid="current-fen" />
		</label>
		{#if graphScores.length > 1}
			<EvalGraph scores={graphScores} current={graphCursor} onselect={selectGraphPly} />
		{/if}
	</div>

	<aside class="side">
		<Panel tier="flat">
			<EnginePanel
				status={view.engine}
				lines={view.lines}
				multiPv={view.multiPv}
				{fen}
				{orientation}
				{isolated}
				{download}
				{pins}
				{pinId}
				{hashChoices}
				{hashMb}
				{effectiveHashMb}
				{hashNotice}
				{threadsMax}
				{threads}
				ontoggle={(on) => void controller.setEngine(on)}
				onmultipv={(value) => void controller.setMultiPv(value)}
				onpin={(id) => restartWith(() => (pinId = id))}
				onhash={(value) =>
					restartWith(() => {
						hashMb = value;
						hashNotice = null;
					})}
				onthreads={(value) => restartWith(() => (threads = value))}
				onplay={(multipv, plies) => controller.playPv(multipv, plies)}
			/>
		</Panel>
		<Panel tier="flat">
			<MoveTree
				{tree}
				revision={view.revision}
				current={view.current}
				ongoto={(id) => controller.goto(id)}
				onpromote={(id) => controller.promote(id)}
				ondelete={(id) => controller.deleteFrom(id)}
				oncopyline={(id) => void copy(controller.lineAsPgn(id), "Line")}
			/>
		</Panel>
		<p class="status text-sm text-ink-secondary" role="status" data-testid="page-status">
			{status ?? ""}
		</p>
	</aside>

	<div class="tools">
		<Panel tier="flat">
			<StartPositionPicker onselect={loadStart} actionLabel="Set up board" />
		</Panel>
		<Panel tier="flat">
			<ImportExport {controller} {fen} oncopy={(text, what) => void copy(text, what)} />
		</Panel>
	</div>
</div>

<style>
	.analysis {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(18rem, 26rem);
		grid-template-areas:
			"notice notice"
			"main side"
			"tools tools";
		gap: 1rem;
		max-width: 80rem;
		margin: 0 auto;
		padding: 1rem;
	}

	.analysis :global(.notice) {
		grid-area: notice;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		overflow-wrap: anywhere;
	}

	.main {
		grid-area: main;
		display: grid;
		gap: 0.75rem;
		align-content: start;
		min-width: 0;
	}

	.stage {
		display: flex;
		gap: 0.5rem;
		width: min(100%, 40rem);
	}

	.stage :global(.bar) {
		flex: none;
		height: auto;
	}

	.stage :global(.board-slot) {
		flex: 1 1 auto;
		min-width: 0;
	}

	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.fen-field {
		display: grid;
		gap: 0.25rem;
		width: min(100%, 40rem);
	}

	.fen {
		width: 100%;
		padding: 0.25rem 0.5rem;
		border: 1px solid var(--fui-line);
		border-radius: var(--fui-radius-sm);
		background: var(--fui-surface-raised);
		color: var(--fui-ink);
		font-family: var(--fui-font-mono);
		font-size: 0.75rem;
	}

	.side {
		grid-area: side;
		display: grid;
		gap: 1rem;
		align-content: start;
		min-width: 0;
	}

	.status {
		min-height: 1.25rem;
	}

	.tools {
		grid-area: tools;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
		gap: 1rem;
	}

	@media (max-width: 60rem) {
		.analysis {
			grid-template-columns: minmax(0, 1fr);
			grid-template-areas:
				"notice"
				"main"
				"side"
				"tools";
		}
	}
</style>
