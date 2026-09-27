<script lang="ts">
import { Button, Callout, Input } from "foundationui/svelte";
import { parseFen } from "$lib/chess/fen";
import { FRC_POSITIONS, frcBackRank, randomFrc } from "$lib/chess/frc";
import type { StartPosition } from "$lib/chess/types";

interface Props {
	onselect: (start: StartPosition) => void;
	actionLabel?: string;
	class?: string;
}

let { onselect, actionLabel = "Set up", class: className = "" }: Props = $props();

type Mode = StartPosition["kind"];

const MODES: readonly { readonly value: Mode; readonly label: string }[] = [
	{ value: "standard", label: "Standard" },
	{ value: "fen", label: "FEN" },
	{ value: "frc", label: "FRC" },
];

const STANDARD_SCHARNAGL = 518;

let mode = $state<Mode>("standard");
let fenText = $state("");
let seedText = $state(String(STANDARD_SCHARNAGL));
let error = $state<string | null>(null);
let info = $state<string | null>(null);

const parseSeed = (text: string): number | null => {
	const trimmed = text.trim();
	if (!/^\d{1,3}$/.test(trimmed)) return null;
	const seed = Number(trimmed);
	return seed < FRC_POSITIONS ? seed : null;
};

const seed = $derived(parseSeed(seedText));

const chooseMode = (value: Mode) => {
	mode = value;
	error = null;
	info = null;
};

const pickRandom = () => {
	seedText = String(randomFrc());
	error = null;
};

const resolve = (): StartPosition | null => {
	if (mode === "standard") return { kind: "standard" };
	if (mode === "frc") {
		if (seed === null) {
			error = `Enter an FRC position number from 0 to ${FRC_POSITIONS - 1}`;
			return null;
		}
		return { kind: "frc", scharnagl: seed };
	}
	const parsed = parseFen(fenText);
	if (!parsed.ok) {
		error = parsed.error.message;
		return null;
	}
	if (parsed.value.fen !== fenText.trim()) info = `Normalised to ${parsed.value.fen}`;
	return { kind: "fen", fen: parsed.value.fen };
};

const submit = (event: SubmitEvent) => {
	event.preventDefault();
	error = null;
	info = null;
	const start = resolve();
	if (start) onselect(start);
};
</script>

<form class={`picker ${className}`} aria-label="Start position" onsubmit={submit}>
	<fieldset class="modes">
		<legend class="text-sm font-semibold text-ink">Start position</legend>
		{#each MODES as option (option.value)}
			<label class="mode">
				<input
					type="radio"
					name="start-mode"
					value={option.value}
					checked={mode === option.value}
					onchange={() => chooseMode(option.value)}
				/>
				{option.label}
			</label>
		{/each}
	</fieldset>

	{#if mode === "fen"}
		<Input
			aria-label="Start FEN"
			placeholder="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
			spellcheck="false"
			autocomplete="off"
			bind:value={fenText}
		/>
	{:else if mode === "frc"}
		<div class="frc">
			<Input
				aria-label="FRC position number"
				inputmode="numeric"
				autocomplete="off"
				class="seed"
				bind:value={seedText}
			/>
			<Button type="button" variant="secondary" size="sm" onclick={pickRandom}>Random</Button>
			{#if seed !== null}
				<span class="summary" data-testid="frc-summary">
					Position {seed}: <span class="font-mono">{frcBackRank(seed)}</span>
				</span>
			{/if}
		</div>
	{/if}

	{#if error}
		<Callout tone="warn" role="alert" class="message">{error}</Callout>
	{/if}
	{#if info}
		<p class="message" role="status">{info}</p>
	{/if}

	<div>
		<Button type="submit" size="sm">{actionLabel}</Button>
	</div>
</form>

<style>
	.picker {
		display: grid;
		gap: 0.75rem;
	}

	.modes {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 1rem;
		border: 0;
		padding: 0;
		margin: 0;
	}

	.modes legend {
		float: left;
		margin-right: 0.5rem;
	}

	.mode {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.875rem;
	}

	.frc {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}

	.frc :global(.seed) {
		width: 6rem;
	}

	.summary {
		font-size: 0.875rem;
		color: var(--fui-ink-secondary);
	}

	.picker :global(.message) {
		font-size: 0.875rem;
		color: var(--fui-ink-secondary);
		overflow-wrap: anywhere;
	}
</style>
