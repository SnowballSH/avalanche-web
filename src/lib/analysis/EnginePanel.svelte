<script lang="ts">
import { Button, Callout, Select, Switch } from "foundationui/svelte";
import Board from "$lib/board/Board.svelte";
import { formatScore } from "$lib/board/eval";
import type { Color, San } from "$lib/chess/types";
import type { Fen, UciMove } from "$lib/engine/types";
import type { PinEntry, PinId } from "$lib/pins/types";
import {
	type EngineLine,
	type EngineStatus,
	fenAfter,
	MULTI_PV_MAX,
	MULTI_PV_MIN,
} from "./controller";

interface Props {
	status: EngineStatus;
	lines: readonly EngineLine[];
	multiPv: number;
	fen: Fen;
	orientation: Color;
	isolated: boolean;
	download: number | null;
	pins: readonly PinEntry[];
	pinId: PinId | null;
	hashChoices: readonly number[];
	hashMb: number;
	effectiveHashMb: number | null;
	hashNotice: string | null;
	threadsMax: number;
	threads: number;
	ontoggle: (on: boolean) => void;
	onmultipv: (multiPv: number) => void;
	onpin: (id: PinId) => void;
	onhash: (hashMb: number) => void;
	onthreads: (threads: number) => void;
	onplay: (multipv: number, plies: number) => void;
}

let {
	status,
	lines,
	multiPv,
	fen,
	orientation,
	isolated,
	download,
	pins,
	pinId,
	hashChoices,
	hashMb,
	effectiveHashMb,
	hashNotice,
	threadsMax,
	threads,
	ontoggle,
	onmultipv,
	onpin,
	onhash,
	onthreads,
	onplay,
}: Props = $props();

const PV_SHOWN = 16;

const MULTI_PV_CHOICES = Array.from(
	{ length: MULTI_PV_MAX - MULTI_PV_MIN + 1 },
	(_, index) => MULTI_PV_MIN + index,
);

interface Preview {
	readonly fen: Fen;
	readonly lastMove: UciMove | null;
}

let preview = $state<Preview | null>(null);

const best = $derived(lines[0]);

const formatCount = (value: number | undefined): string => {
	if (value === undefined) return "–";
	if (value >= 1e9) return `${(value / 1e9).toFixed(1)}G`;
	if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
	if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
	return String(value);
};

const pvLabels = (from: Fen, sans: readonly San[]): string[] => {
	const [, turn, , , , fullmove] = from.split(" ");
	let white = turn === "w";
	let number = Number(fullmove);
	return sans.map((san, index) => {
		const label = white ? `${number}. ${san}` : index === 0 ? `${number}… ${san}` : san;
		if (!white) number += 1;
		white = !white;
		return label;
	});
};

const statusText = $derived.by(() => {
	switch (status.kind) {
		case "off":
			return "Off";
		case "starting":
			return download === null
				? "Starting the engine…"
				: `Downloading the engine… ${Math.floor(download * 100)}%`;
		case "running":
			return "Analysing";
		case "suspended":
			return "Paused while a game uses the engine";
		case "failed":
			return "Stopped";
	}
});

const showPreview = (line: EngineLine, plies: number) => {
	const moves = line.pv.slice(0, plies);
	preview = { fen: fenAfter(fen, moves), lastMove: moves.at(-1) ?? null };
};

const hidePreview = () => {
	preview = null;
};

const selectedPin = $derived(pins.find((pin) => pin.id === pinId));
</script>

<section class="engine-panel" aria-label="Engine">
	<header class="head">
		<Switch
			aria-label="Engine"
			checked={status.kind !== "off"}
			disabled={!isolated}
			onCheckedChange={ontoggle}
		/>
		<div class="title">
			<span class="font-semibold text-ink">Avalanche</span>
			<span class="text-xs text-ink-muted">{selectedPin?.label ?? ""}</span>
		</div>
		<span class="status text-sm text-ink-secondary" data-testid="engine-status">{statusText}</span>
	</header>

	{#if !isolated}
		<Callout tone="warn" data-testid="isolation-refusal">
			<p class="font-semibold">The engine cannot run on this page.</p>
			<p>
				Avalanche stops a running search through shared memory, which browsers only allow on a
				cross-origin isolated page (served with <code>Cross-Origin-Opener-Policy: same-origin</code>
				and <code>Cross-Origin-Embedder-Policy: require-corp</code>). This page was loaded without
				that isolation, so a search could not be stopped once it started. Open the site from its own
				address, and check that no proxy or extension strips those headers.
			</p>
		</Callout>
	{/if}

	{#if status.kind === "starting" && download !== null}
		<progress class="download" max="1" value={download} aria-label="Engine download"></progress>
	{/if}

	{#if status.kind === "failed"}
		<Callout tone="warn" role="alert">
			<p>{status.message}</p>
			<Button size="sm" variant="secondary" onclick={() => ontoggle(true)}>Try again</Button>
		</Callout>
	{/if}

	{#if hashNotice}
		<Callout tone="info" role="status">{hashNotice}</Callout>
	{/if}

	<dl class="stats" data-testid="engine-stats">
		<div>
			<dt>Depth</dt>
			<dd data-testid="engine-depth">
				{best ? `${best.depth}${best.seldepth !== undefined ? `/${best.seldepth}` : ""}` : "–"}
			</dd>
		</div>
		<div>
			<dt>Nodes</dt>
			<dd>{formatCount(best?.nodes)}</dd>
		</div>
		<div>
			<dt>Speed</dt>
			<dd>{best?.nps === undefined ? "–" : `${formatCount(best.nps)}n/s`}</dd>
		</div>
		<div>
			<dt>Hash</dt>
			<dd>{effectiveHashMb ?? hashMb} MB</dd>
		</div>
	</dl>

	<div class="settings">
		<label>
			<span>Lines</span>
			<Select
				class="h-8 text-sm"
				aria-label="Lines"
				value={String(multiPv)}
				onchange={(event) => onmultipv(Number(event.currentTarget.value))}
			>
				{#each MULTI_PV_CHOICES as choice (choice)}
					<option value={String(choice)}>{choice}</option>
				{/each}
			</Select>
		</label>
		<label>
			<span>Version</span>
			<Select
				class="h-8 text-sm"
				aria-label="Engine version"
				value={pinId ?? ""}
				disabled={pins.length === 0}
				onchange={(event) => onpin(event.currentTarget.value)}
			>
				{#each pins as pin (pin.id)}
					<option value={pin.id}>{pin.label}</option>
				{/each}
			</Select>
		</label>
		<label>
			<span>Hash</span>
			<Select
				class="h-8 text-sm"
				aria-label="Hash"
				value={String(hashMb)}
				onchange={(event) => onhash(Number(event.currentTarget.value))}
			>
				{#each hashChoices as choice (choice)}
					<option value={String(choice)}>{choice} MB</option>
				{/each}
			</Select>
		</label>
		{#if threadsMax > 1}
			<label>
				<span>Threads</span>
				<Select
					class="h-8 text-sm"
					aria-label="Threads"
					value={String(threads)}
					onchange={(event) => onthreads(Number(event.currentTarget.value))}
				>
					{#each Array.from({ length: threadsMax }, (_, index) => index + 1) as choice (choice)}
						<option value={String(choice)}>{choice}</option>
					{/each}
				</Select>
			</label>
		{/if}
	</div>

	<ol class="lines" aria-label="Engine lines">
		{#each lines as line (line.multipv)}
			<li class="line" data-testid="pv-line" data-multipv={line.multipv}>
				<span class="score" data-testid="pv-score">{formatScore(line.score)}</span>
				<span class="moves">
					{#each pvLabels(fen, line.san.slice(0, PV_SHOWN)) as label, index (index)}
						<button
							type="button"
							class="pv-move"
							onclick={() => onplay(line.multipv, index + 1)}
							onmouseenter={() => showPreview(line, index + 1)}
							onmouseleave={hidePreview}
							onfocus={() => showPreview(line, index + 1)}
							onblur={hidePreview}
						>
							{label}
						</button>
					{/each}
				</span>
			</li>
		{/each}
	</ol>

	{#if preview}
		<div class="preview" data-testid="pv-preview" aria-hidden="true">
			<Board fen={preview.fen} lastMove={preview.lastMove} {orientation} coordinates={false} />
		</div>
	{/if}
</section>

<style>
	.engine-panel {
		position: relative;
		display: grid;
		gap: 0.75rem;
	}

	.head {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.title {
		display: grid;
		line-height: 1.2;
	}

	.status {
		margin-left: auto;
		text-align: right;
	}

	.download {
		width: 100%;
		accent-color: var(--fui-accent);
	}

	.stats {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.5rem;
		margin: 0;
		font-size: 0.75rem;
	}

	.stats dt {
		color: var(--fui-ink-muted);
	}

	.stats dd {
		margin: 0;
		font-family: var(--fui-font-mono);
		color: var(--fui-ink);
	}

	.settings {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 0.75rem;
		font-size: 0.75rem;
		color: var(--fui-ink-muted);
	}

	.settings label {
		display: grid;
		gap: 0.25rem;
	}

	.lines {
		display: grid;
		gap: 0.25rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.line {
		display: flex;
		gap: 0.5rem;
		align-items: baseline;
		min-width: 0;
		font-size: 0.8125rem;
	}

	.score {
		flex: none;
		min-width: 3.5rem;
		font-family: var(--fui-font-mono);
		font-weight: 600;
		color: var(--fui-ink);
	}

	.moves {
		display: flex;
		flex-wrap: wrap;
		gap: 0 0.25rem;
		min-width: 0;
	}

	.pv-move {
		border: 0;
		padding: 0 0.125rem;
		border-radius: var(--fui-radius-xs);
		background: transparent;
		color: var(--fui-ink-secondary);
		font: inherit;
		cursor: pointer;
	}

	.pv-move:hover,
	.pv-move:focus-visible {
		background: color-mix(in srgb, var(--fui-accent) 20%, transparent);
		color: var(--fui-ink);
	}

	.pv-move:focus-visible {
		outline: 2px solid var(--fui-accent);
		outline-offset: 1px;
	}

	.preview {
		position: absolute;
		right: 0;
		top: calc(100% + 0.5rem);
		z-index: 10;
		width: 12rem;
		padding: 0.25rem;
		border-radius: var(--fui-radius-sm);
		background: var(--fui-surface-raised);
		box-shadow: var(--fui-shadow-float-2);
		pointer-events: none;
	}
</style>
