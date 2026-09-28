<script lang="ts">
import type { Color } from "$lib/chess/types";
import { evalBarFraction, formatScore, type PovScore } from "./eval";

interface Props {
	score: PovScore | null;
	orientation?: Color;
	class?: string;
}

let { score, orientation = "white", class: className = "" }: Props = $props();

const fraction = $derived(evalBarFraction(score));
const label = $derived(formatScore(score));
</script>

<div class={`eval ${className}`}>
	<span class="label" data-testid="eval-label" aria-hidden="true">{label}</span>
	<div
		class="meter"
		class:flipped={orientation === "black"}
		role="meter"
		aria-label="Evaluation"
		aria-valuemin="0"
		aria-valuemax="100"
		aria-valuenow={Math.round(fraction * 100)}
		aria-valuetext={label || "No evaluation"}
		data-score={label}
	>
		<div class="white" style={`height: ${fraction * 100}%`}></div>
	</div>
</div>

<style>
	.eval {
		--eval-white: #f2f2f2;
		--eval-black: #262626;
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		justify-items: center;
		gap: 0.25rem;
		inline-size: max-content;
		min-inline-size: 6ch;
		block-size: 100%;
		font-family: var(--fui-font-mono);
		font-size: 0.6875rem;
	}

	.label {
		min-block-size: 1lh;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		line-height: 1.2;
		white-space: nowrap;
		color: var(--fui-ink);
	}

	.meter {
		display: flex;
		flex-direction: column-reverse;
		inline-size: 1.25rem;
		overflow: hidden;
		border-radius: var(--fui-radius-xs);
		background: var(--eval-black);
	}

	.flipped {
		flex-direction: column;
	}

	.white {
		background: var(--eval-white);
		transition: height 300ms ease;
	}
</style>
