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
const whiteLeads = $derived(fraction >= 0.5);
</script>

<div
	class={`eval-bar ${className}`}
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
	<span class="label" class:on-white={whiteLeads}>{label}</span>
</div>

<style>
	.eval-bar {
		--eval-white: #f2f2f2;
		--eval-black: #262626;
		position: relative;
		display: flex;
		flex-direction: column-reverse;
		width: 1.25rem;
		height: 100%;
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

	.label {
		position: absolute;
		left: 0;
		right: 0;
		text-align: center;
		font-family: var(--fui-font-mono);
		font-size: 0.6rem;
		font-weight: 600;
		line-height: 1;
		top: 0.25rem;
		color: var(--eval-white);
	}

	.label.on-white {
		top: auto;
		bottom: 0.25rem;
		color: var(--eval-black);
	}

	.flipped .label {
		top: auto;
		bottom: 0.25rem;
	}

	.flipped .label.on-white {
		top: 0.25rem;
		bottom: auto;
	}
</style>
