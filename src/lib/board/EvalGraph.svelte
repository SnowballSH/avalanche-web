<script lang="ts">
import { type PovScore, whiteWinChance } from "./eval";

interface Props {
	scores: readonly (PovScore | null)[];
	current: number;
	onselect?: (index: number) => void;
	class?: string;
}

let { scores, current, onselect, class: className = "" }: Props = $props();

const HEIGHT = 100;

const width = $derived(Math.max(scores.length, 1));

const heights = $derived.by(() => {
	let chance = 0;
	return scores.map((score) => {
		if (score !== null) chance = whiteWinChance(score);
		return (HEIGHT * (1 - chance)) / 2;
	});
});

const area = $derived.by(() => {
	const first = heights[0];
	const last = heights[heights.length - 1];
	if (first === undefined || last === undefined) return "";
	const points = heights.map((y, index) => `L ${index + 0.5} ${y}`).join(" ");
	return `M 0 ${HEIGHT} L 0 ${first} ${points} L ${width} ${last} L ${width} ${HEIGHT} Z`;
});

const label = (index: number) => (index === 0 ? "Start position" : `Ply ${index}`);
</script>

<div class={`eval-graph ${className}`}>
	<svg viewBox={`0 0 ${width} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
		<path class="white-area" d={area} />
		<line class="midline" x1="0" y1={HEIGHT / 2} x2={width} y2={HEIGHT / 2} vector-effect="non-scaling-stroke" />
		{#if scores.length > 0}
			<line
				class="cursor"
				x1={current + 0.5}
				y1="0"
				x2={current + 0.5}
				y2={HEIGHT}
				vector-effect="non-scaling-stroke"
			/>
		{/if}
	</svg>
	<div class="hits">
		{#each scores as _, index (index)}
			<button
				type="button"
				class="hit"
				aria-label={label(index)}
				aria-pressed={index === current}
				onclick={() => onselect?.(index)}
			></button>
		{/each}
	</div>
</div>

<style>
	.eval-graph {
		--eval-white: #f2f2f2;
		--eval-black: #262626;
		position: relative;
		width: 100%;
		height: 5rem;
		overflow: hidden;
		border-radius: var(--fui-radius-xs);
		background: var(--eval-black);
	}

	svg {
		display: block;
		width: 100%;
		height: 100%;
	}

	.white-area {
		fill: var(--eval-white);
	}

	.midline {
		stroke: var(--fui-ink-muted);
		stroke-width: 1;
	}

	.cursor {
		stroke: var(--fui-accent);
		stroke-width: 2;
	}

	.hits {
		position: absolute;
		inset: 0;
		display: flex;
	}

	.hit {
		flex: 1 1 0;
		min-width: 0;
		border: 0;
		padding: 0;
		background: transparent;
		cursor: pointer;
	}

	.hit:hover,
	.hit:focus-visible {
		background: color-mix(in srgb, var(--fui-accent) 25%, transparent);
	}

	.hit:focus-visible {
		outline: 2px solid var(--fui-accent);
		outline-offset: -2px;
	}
</style>
