<script lang="ts">
import { Button } from "foundationui/svelte";
import type { GameTree, NodeId } from "$lib/chess/types";
import { moveTokens } from "./move-tokens";

interface Props {
	tree: GameTree;
	revision: number;
	current: NodeId;
	ongoto: (id: NodeId) => void;
	onpromote: (id: NodeId) => void;
	ondelete: (id: NodeId) => void;
	oncopyline: (id: NodeId) => void;
}

let { tree, revision, current, ongoto, onpromote, ondelete, oncopyline }: Props = $props();

let list = $state<HTMLElement>();

const tokens = $derived.by(() => {
	void revision;
	return moveTokens(tree);
});

const isVariation = $derived.by(() => {
	void revision;
	return !tree.mainline().includes(current);
});

const atRoot = $derived(current === tree.root);

$effect(() => {
	const active = list?.querySelector<HTMLElement>(`[data-node-id="${current}"]`);
	active?.scrollIntoView({ block: "nearest" });
});
</script>

<section class="move-tree" aria-label="Moves">
	<div class="list" bind:this={list} data-testid="move-list">
		{#if tokens.length === 0}
			<p class="empty text-sm text-ink-muted">No moves yet. Play one on the board.</p>
		{/if}
		{#each tokens as token, index (index)}
			{#if token.kind === "move"}
				<button
					type="button"
					class="move"
					class:variation={token.depth > 0}
					class:current={token.id === current}
					data-node-id={token.id}
					aria-current={token.id === current ? "step" : undefined}
					onclick={() => ongoto(token.id)}
				>
					{token.label}
				</button>
			{:else}
				<span class="paren" aria-hidden="true">{token.kind === "open" ? "(" : ")"}</span>
			{/if}
		{/each}
	</div>
	<div class="actions">
		<Button
			size="sm"
			variant="secondary"
			disabled={!isVariation}
			onclick={() => onpromote(current)}
		>
			Promote variation
		</Button>
		<Button size="sm" variant="secondary" disabled={atRoot} onclick={() => ondelete(current)}>
			Delete from here
		</Button>
		<Button size="sm" variant="secondary" disabled={atRoot} onclick={() => oncopyline(current)}>
			Copy line as PGN
		</Button>
	</div>
</section>

<style>
	.move-tree {
		display: grid;
		gap: 0.5rem;
	}

	.list {
		display: flex;
		flex-wrap: wrap;
		align-content: flex-start;
		gap: 0.125rem 0.25rem;
		max-height: 20rem;
		min-height: 4rem;
		overflow-y: auto;
		padding: 0.5rem;
		border: 1px solid var(--fui-line);
		border-radius: var(--fui-radius-sm);
		background: var(--fui-surface-raised);
		font-size: 0.875rem;
	}

	.move {
		border: 0;
		padding: 0.0625rem 0.25rem;
		border-radius: var(--fui-radius-xs);
		background: transparent;
		color: var(--fui-ink);
		font: inherit;
		cursor: pointer;
	}

	.move.variation {
		color: var(--fui-ink-secondary);
		font-size: 0.8125rem;
	}

	.move:hover {
		background: color-mix(in srgb, var(--fui-accent) 15%, transparent);
	}

	.move.current {
		background: color-mix(in srgb, var(--fui-accent) 35%, transparent);
		color: var(--fui-ink);
		font-weight: 600;
	}

	.paren {
		color: var(--fui-ink-muted);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
</style>
