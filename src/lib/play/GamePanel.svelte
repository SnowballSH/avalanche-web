<script lang="ts">
import { Button, Callout } from "foundationui/svelte";
import type { Color, GameResult } from "$lib/chess/types";
import type { PlayState } from "./controller";
import { formatClock, moveRows, resultText } from "./display";

interface Props {
	state: PlayState;
	whiteMs: number | null;
	blackMs: number | null;
	orientation: Color;
	canTakeback: boolean;
	download: number | null;
	onresign: () => void;
	ondraw: () => void;
	ontakeback: () => void;
	onflip: () => void;
	onanalyse: () => void;
	ondownload: () => void;
	onnewgame: () => void;
	onretry: () => void;
	ondismiss: () => void;
}

let {
	state,
	whiteMs,
	blackMs,
	orientation,
	canTakeback,
	download,
	onresign,
	ondraw,
	ontakeback,
	onflip,
	onanalyse,
	ondownload,
	onnewgame,
	onretry,
	ondismiss,
}: Props = $props();

const userColor = $derived(state.setup?.userColor ?? "white");
const playing = $derived(state.phase === "playing");
const rows = $derived.by(() => {
	void state.revision;
	return moveRows(state.tree);
});
const top = $derived<Color>(orientation === "white" ? "black" : "white");
const bottom = $derived<Color>(orientation);
const running = $derived(playing ? (state.clock?.running ?? null) : null);

const msFor = (side: Color): number | null => (side === "white" ? whiteMs : blackMs);

const nameFor = (side: Color): string => (side === userColor ? "You" : "Avalanche");

const engineText = $derived.by(() => {
	switch (state.engine.kind) {
		case "idle":
			return "";
		case "connecting":
			return download === null
				? "Starting the engine…"
				: `Downloading the engine… ${Math.floor(download * 100)}%`;
		case "thinking":
			return "Avalanche is thinking…";
		case "pondering":
			return "Avalanche is pondering…";
		case "failed":
			return state.engine.message;
	}
});

const describe = (result: GameResult | null): string => (result ? resultText(result) : "");
</script>

{#snippet clock(side: Color)}
	{@const ms = msFor(side)}
	<div class="clock" class:running={running === side} data-testid={`clock-${side}`}>
		<span class="name">{nameFor(side)}</span>
		<span class="time font-mono" class:low={ms !== null && ms < 10_000}>
			{ms === null ? "–" : formatClock(ms)}
		</span>
	</div>
{/snippet}

<section class="game-panel" aria-label="Game" data-phase={state.phase}>
	{@render clock(top)}

	<ol class="moves" data-testid="play-moves">
		{#each rows as row (row.number)}
			<li>
				<span class="number">{row.number}.</span>
				<span class="move">{row.white ?? "…"}</span>
				<span class="move">{row.black ?? ""}</span>
			</li>
		{/each}
	</ol>

	{@render clock(bottom)}

	<p class="engine text-sm text-ink-secondary" role="status" data-testid="play-engine-status">
		{engineText}
	</p>
	{#if state.engine.kind === "failed"}
		<Button size="sm" variant="secondary" onclick={onretry}>Retry the engine</Button>
	{/if}

	{#if state.notice}
		<Callout tone="info" role="status" class="notice" data-testid="play-notice">
			<span>{state.notice}</span>
			<Button size="sm" variant="ghost" onclick={ondismiss}>Dismiss</Button>
		</Callout>
	{/if}

	{#if state.result}
		<p class="result font-semibold text-ink" data-testid="play-result">{describe(state.result)}</p>
	{/if}

	<div class="actions">
		{#if playing}
			<Button size="sm" variant="secondary" disabled={!canTakeback} onclick={ontakeback}>
				Takeback
			</Button>
			<Button size="sm" variant="secondary" onclick={ondraw}>Offer draw</Button>
			<Button size="sm" variant="secondary" onclick={onresign}>Resign</Button>
		{:else if state.phase === "starting"}
			<Button size="sm" variant="secondary" onclick={onresign}>Resign</Button>
		{:else if state.phase === "over"}
			<Button size="sm" onclick={onanalyse}>Analyse this game</Button>
			<Button size="sm" variant="secondary" onclick={ondownload}>Download PGN</Button>
		{/if}
		{#if state.phase !== "playing" && state.phase !== "starting"}
			<Button size="sm" variant="secondary" onclick={onnewgame}>New game</Button>
		{/if}
		<Button size="sm" variant="ghost" onclick={onflip}>Flip</Button>
	</div>
</section>

<style>
	.game-panel {
		display: grid;
		gap: 0.75rem;
	}

	.clock {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--fui-line);
		border-radius: var(--fui-radius-sm);
		background: var(--fui-surface-raised);
	}

	.clock.running {
		border-color: var(--fui-accent);
	}

	.name {
		font-size: 0.875rem;
		color: var(--fui-ink-secondary);
	}

	.time {
		font-size: 1.5rem;
		font-variant-numeric: tabular-nums;
		color: var(--fui-ink);
	}

	.time.low {
		color: var(--fui-accent-strong);
	}

	.moves {
		display: grid;
		max-height: 16rem;
		overflow-y: auto;
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: 0.875rem;
	}

	.moves li {
		display: grid;
		grid-template-columns: 2.5rem 1fr 1fr;
		gap: 0.5rem;
		padding: 0.125rem 0.25rem;
	}

	.number {
		color: var(--fui-ink-muted);
	}

	.engine {
		min-height: 1.25rem;
		overflow-wrap: anywhere;
	}

	.game-panel :global(.notice) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
</style>
