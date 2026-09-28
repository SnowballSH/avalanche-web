<script lang="ts">
import { Callout } from "foundationui/svelte";
import { onMount } from "svelte";
import { goto } from "$app/navigation";
import Board from "$lib/board/Board.svelte";
import EvalBar from "$lib/board/EvalBar.svelte";
import { legalDests } from "$lib/board/moves";
import { positionFromFen } from "$lib/chess/fen";
import type { Color } from "$lib/chess/types";
import { hashChoices as hashChoicesFor } from "$lib/engine/memory";
import type { EngineCapabilities, EngineScheduler } from "$lib/engine/types";
import { getDefaultPin } from "$lib/pins/default-pin";
import type { PinEntry, PinId } from "$lib/pins/types";
import { type EngineConnector, PlayController } from "$lib/play/controller";
import GamePanel from "$lib/play/GamePanel.svelte";
import { browserPlayStore } from "$lib/play/persist";
import SetupDialog from "$lib/play/SetupDialog.svelte";
import { handOffToAnalysis } from "$lib/shared/analysis-handoff";
import {
	browserEngineRuntime,
	defaultHashMb,
	deviceMemoryGb,
	engineErrorMessage,
	isCrossOriginIsolated,
} from "$lib/shared/engine-runtime";
import { saveTextFile } from "$lib/shared/save-file";

const CLOCK_REFRESH_MS = 100;

const scheduler: EngineScheduler = {
	acquire: (owner) => browserEngineRuntime().scheduler.acquire(owner),
	release: (lease) => browserEngineRuntime().scheduler.release(lease),
};

let isolated = $state(true);
let pins = $state.raw<readonly PinEntry[]>([]);
let defaultPinId = $state<PinId | null>(null);
let hashChoices = $state.raw<readonly number[]>([]);
let hashMb = $state(0);
let download = $state<number | null>(null);
let capabilities = $state.raw<EngineCapabilities | null>(null);
let probeError = $state<string | null>(null);
let hashNotice = $state<string | null>(null);
let setupOpen = $state(false);
let flipped = $state(false);
let now = $state(0);
let board = $state<ReturnType<typeof Board>>();

const connect: EngineConnector = async (pinId, options) => {
	const runtime = browserEngineRuntime();
	try {
		const catalogue = await runtime.catalogue();
		const pin = catalogue.pins.find((entry) => entry.id === pinId);
		if (!pin) throw new Error(`The engine version ${pinId} is no longer offered`);
		download = 0;
		await runtime.pins.download(pin, (fraction) => {
			download = fraction;
		});
		download = null;
		return await runtime.sessions.ensure(pin, options);
	} catch (error) {
		throw new Error(engineErrorMessage(error));
	} finally {
		download = null;
	}
};

const controller = new PlayController({
	scheduler,
	connect,
	now: () => performance.now(),
	store: browserPlayStore(),
	saveFile: saveTextFile,
});

let view = $state.raw(controller.state);

let probeKey = "";

const probe = async (pinId: PinId, hash: number) => {
	const key = `${pinId}|${hash}`;
	if (key === probeKey || !isolated) return;
	probeKey = key;
	capabilities = null;
	probeError = null;
	try {
		const session = await connect(pinId, { hashMb: hash });
		const found = session.capabilities ?? (await session.handshake());
		if (probeKey === key) capabilities = found;
	} catch (error) {
		if (probeKey !== key) return;
		probeKey = "";
		probeError = error instanceof Error ? error.message : String(error);
	}
};

const tree = $derived(view.tree);
const lastNode = $derived.by(() => {
	void view.revision;
	return tree.node(tree.mainline().at(-1) ?? tree.root);
});
const fen = $derived(lastNode.fen);
const chess960 = $derived(tree.start.kind === "frc");
const userColor = $derived<Color>(view.setup?.userColor ?? "white");
const orientation = $derived<Color>(
	flipped ? (userColor === "white" ? "black" : "white") : userColor,
);
const movable = $derived({
	color: userColor,
	dests: view.phase === "playing" ? legalDests(fen, chess960) : new Map(),
});
const inCheck = $derived(positionFromFen(fen).isCheck());
const whiteMs = $derived.by(() => {
	void now;
	void view;
	return controller.remaining("white");
});
const blackMs = $derived.by(() => {
	void now;
	void view;
	return controller.remaining("black");
});
const canTakeback = $derived.by(() => {
	void view;
	return controller.canTakeback();
});

$effect(() => {
	if (view.premove === null) board?.cancelPremove();
});

const refresh = () => {
	controller.tick();
	now = performance.now();
};

const openSetup = () => {
	probeKey = "";
	setupOpen = true;
};

const analyse = async () => {
	handOffToAnalysis(controller.toAnalysis());
	await goto("/analysis");
};

onMount(() => {
	isolated = isCrossOriginIsolated();
	hashChoices = hashChoicesFor(deviceMemoryGb());
	hashMb = defaultHashMb();
	const unsubscribe = controller.subscribe((state) => {
		view = state;
	});
	let stopNotices = () => {};
	if (isolated) {
		const runtime = browserEngineRuntime();
		stopNotices = runtime.sessions.host.onNotice((notice) => {
			if (notice.kind !== "hash-allocation-failed") return;
			hashNotice = `${notice.requestedMb} MB of Hash could not be allocated; the engine is using ${notice.effectiveMb} MB.`;
		});
		runtime
			.catalogue()
			.then((catalogue) => {
				pins = catalogue.pins;
				defaultPinId = getDefaultPin(catalogue)?.id ?? null;
			})
			.catch((error: unknown) => {
				probeError = engineErrorMessage(error);
			});
		if (!controller.resume()) setupOpen = true;
	}
	const timer = setInterval(refresh, CLOCK_REFRESH_MS);
	const onVisibility = () => {
		if (document.visibilityState === "visible") refresh();
		else controller.save();
	};
	const onHide = () => controller.save();
	document.addEventListener("visibilitychange", onVisibility);
	window.addEventListener("pagehide", onHide);
	return () => {
		clearInterval(timer);
		document.removeEventListener("visibilitychange", onVisibility);
		window.removeEventListener("pagehide", onHide);
		stopNotices();
		unsubscribe();
		controller.dispose();
	};
});
</script>

<svelte:head>
	<title>Play · Avalanche</title>
</svelte:head>

<div class="play">
	<h1 class="sr-only">Play</h1>

	<div class="notices">
		{#if !isolated}
			<Callout tone="warn" data-testid="isolation-refusal">
				<p class="font-semibold">The engine cannot run on this page.</p>
				<p>
					Avalanche needs a cross-origin isolated page to stop a running search, and this page was
					loaded without that isolation. Open the site from its own address, and check that no
					proxy or extension strips its Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy
					headers.
				</p>
			</Callout>
		{/if}
		{#if hashNotice}
			<Callout tone="info" role="status">{hashNotice}</Callout>
		{/if}
	</div>

	<div class="main">
		<div class="stage">
			{#if view.phase === "over"}
				<EvalBar score={view.lastScore} {orientation} class="bar" />
			{/if}
			<Board
				bind:this={board}
				{fen}
				{orientation}
				{movable}
				lastMove={lastNode.move}
				check={inCheck}
				premovable={view.phase === "playing"}
				{chess960}
				onmove={(uci) => controller.userMove(uci)}
				onpremove={(uci) => controller.premove(uci)}
				class="board-slot"
			/>
		</div>
		<label class="fen-field">
			<span class="text-xs text-ink-muted">FEN</span>
			<input class="fen" readonly value={fen} data-testid="play-fen" />
		</label>
	</div>

	<aside class="side">
		<GamePanel
			state={view}
			{whiteMs}
			{blackMs}
			{orientation}
			{canTakeback}
			{download}
			onresign={() => controller.resign()}
			ondraw={() => controller.offerDraw()}
			ontakeback={() => controller.takeback()}
			onflip={() => (flipped = !flipped)}
			onanalyse={() => void analyse()}
			ondownload={() => controller.downloadPgn()}
			onnewgame={openSetup}
			onretry={() => void controller.retryEngine()}
			ondismiss={() => controller.dismissNotice()}
		/>
	</aside>
</div>

{#if isolated}
	<SetupDialog
		bind:open={setupOpen}
		{pins}
		pinId={defaultPinId}
		{hashChoices}
		{hashMb}
		{capabilities}
		{download}
		{probeError}
		onprobe={(pinId, hash) => void probe(pinId, hash)}
		onstart={(settings) => void controller.start(settings)}
	/>
{/if}

<style>
	.play {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(16rem, 22rem);
		grid-template-areas:
			"notices notices"
			"main side";
		gap: 1rem;
		max-width: 72rem;
		margin: 0 auto;
		padding: 1rem;
	}

	.notices {
		grid-area: notices;
		display: grid;
		gap: 0.5rem;
		overflow-wrap: anywhere;
	}

	.notices:empty {
		display: none;
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
		min-width: 0;
	}

	@media (max-width: 56rem) {
		.play {
			grid-template-columns: minmax(0, 1fr);
			grid-template-areas:
				"notices"
				"main"
				"side";
		}
	}
</style>
