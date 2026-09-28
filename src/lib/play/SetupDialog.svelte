<script lang="ts">
import { Callout, Dialog, Input, Select } from "foundationui/svelte";
import type { StartPosition } from "$lib/chess/types";
import type { EngineCapabilities } from "$lib/engine/types";
import type { PinEntry, PinId } from "$lib/pins/types";
import StartPositionPicker from "$lib/shared/StartPositionPicker.svelte";
import {
	CUSTOM_TIME_CONTROL,
	customTimeControl,
	DEFAULT_ELO,
	DEFAULT_TIME_CONTROL,
	ENGINE_LIMIT_LABELS,
	TIME_CONTROL_PRESETS,
	timeControlLabel,
} from "./setup";
import type { EngineLimitKind, PlaySettings, SideChoice } from "./types";

interface Props {
	open: boolean;
	pins: readonly PinEntry[];
	pinId: PinId | null;
	hashChoices: readonly number[];
	hashMb: number;
	capabilities: EngineCapabilities | null;
	download: number | null;
	probeError: string | null;
	onprobe: (pinId: PinId, hashMb: number) => void;
	onstart: (settings: PlaySettings) => void;
}

let {
	open = $bindable(),
	pins,
	pinId,
	hashChoices,
	hashMb,
	capabilities,
	download,
	probeError,
	onprobe,
	onstart,
}: Props = $props();

const SIDES: readonly { readonly value: SideChoice; readonly label: string }[] = [
	{ value: "white", label: "White" },
	{ value: "black", label: "Black" },
	{ value: "random", label: "Random" },
];

let side = $state<SideChoice>("white");
let chosenPin = $state<PinId | null>(null);
let chosenHash = $state<number | null>(null);
let limited = $state(false);
let elo = $state(DEFAULT_ELO);
let timeControl = $state(timeControlLabel(DEFAULT_TIME_CONTROL));
let customMinutes = $state("5");
let customIncrement = $state("3");
let limitKind = $state<EngineLimitKind | "none">("none");
let limitValue = $state("");
let threads = $state(1);
let ponder = $state(false);
let error = $state<string | null>(null);

const selectedPin = $derived(chosenPin ?? pinId);
const selectedHash = $derived(chosenHash ?? hashMb);
const eloRange = $derived(capabilities?.eloRange ?? null);
const threadsMax = $derived(capabilities?.threadsMax ?? 1);
const clampedElo = $derived(eloRange ? Math.min(eloRange.max, Math.max(eloRange.min, elo)) : elo);

const engineStatus = $derived.by(() => {
	if (probeError) return probeError;
	if (download !== null) return `Downloading the engine… ${Math.floor(download * 100)}%`;
	return capabilities ? "Engine ready" : "Loading the engine…";
});

$effect(() => {
	if (open && selectedPin !== null) onprobe(selectedPin, selectedHash);
});

const parsePositive = (text: string): number | null => {
	const value = Number(text.trim());
	return Number.isSafeInteger(value) && value > 0 ? value : null;
};

const resolveTimeControl = () => {
	if (timeControl !== CUSTOM_TIME_CONTROL) {
		return TIME_CONTROL_PRESETS.find((preset) => timeControlLabel(preset) === timeControl) ?? null;
	}
	return customTimeControl(Number(customMinutes), Number(customIncrement));
};

const resolveLimit = () => {
	if (limitKind === "none") return { ok: true as const, limit: null };
	const value = parsePositive(limitValue);
	return value === null
		? { ok: false as const }
		: { ok: true as const, limit: { kind: limitKind, value } };
};

const start = (position: StartPosition) => {
	error = null;
	if (selectedPin === null || !capabilities) {
		error = "Wait until the engine is ready.";
		return;
	}
	const control = resolveTimeControl();
	if (!control) {
		error = "Enter a base time of 0.25 to 180 minutes and a whole-second increment of 0 to 180.";
		return;
	}
	const engineLimit = resolveLimit();
	if (!engineLimit.ok) {
		error = `Enter a positive whole number for the ${ENGINE_LIMIT_LABELS[limitKind as EngineLimitKind].toLowerCase()} limit.`;
		return;
	}
	open = false;
	onstart({
		side,
		start: position,
		pinId: selectedPin,
		strength: limited && eloRange ? { kind: "elo", elo: clampedElo } : { kind: "full" },
		timeControl: control,
		engineLimit: engineLimit.limit,
		hashMb: selectedHash,
		threads: threadsMax > 1 ? Math.min(threads, threadsMax) : null,
		ponder,
	});
};
</script>

<Dialog bind:open title="New game" description="Play Avalanche in your browser." size="md">
	<div class="setup" data-testid="play-setup">
		<fieldset class="row">
			<legend class="label">Your side</legend>
			{#each SIDES as option (option.value)}
				<label class="choice">
					<input
						type="radio"
						name="play-side"
						value={option.value}
						checked={side === option.value}
						onchange={() => (side = option.value)}
					/>
					{option.label}
				</label>
			{/each}
		</fieldset>

		<div class="grid">
			<label class="field">
				<span class="label">Engine version</span>
				<Select
					class="h-8 text-sm"
					value={selectedPin ?? ""}
					onchange={(event) => (chosenPin = event.currentTarget.value)}
				>
					{#each pins as pin (pin.id)}
						<option value={pin.id}>{pin.label}</option>
					{/each}
				</Select>
			</label>
			<label class="field">
				<span class="label">Hash</span>
				<Select
					class="h-8 text-sm"
					value={String(selectedHash)}
					onchange={(event) => (chosenHash = Number(event.currentTarget.value))}
				>
					{#each hashChoices as choice (choice)}
						<option value={String(choice)}>{choice} MB</option>
					{/each}
				</Select>
			</label>
			{#if threadsMax > 1}
				<label class="field">
					<span class="label">Threads</span>
					<Select
						class="h-8 text-sm"
						value={String(threads)}
						onchange={(event) => (threads = Number(event.currentTarget.value))}
					>
						{#each Array.from({ length: threadsMax }, (_, index) => index + 1) as count (count)}
							<option value={String(count)}>{count}</option>
						{/each}
					</Select>
				</label>
			{/if}
		</div>

		<p class="status text-sm text-ink-secondary" role="status" data-testid="setup-engine-status">
			{engineStatus}
		</p>

		<fieldset class="row">
			<legend class="label">Strength</legend>
			<label class="choice">
				<input type="radio" name="play-strength" checked={!limited} onchange={() => (limited = false)} />
				Full
			</label>
			<label class="choice">
				<input
					type="radio"
					name="play-strength"
					checked={limited}
					disabled={!eloRange}
					onchange={() => (limited = true)}
				/>
				Elo
			</label>
			{#if limited && eloRange}
				<input
					class="slider"
					type="range"
					aria-label="Elo"
					min={eloRange.min}
					max={eloRange.max}
					step="10"
					value={clampedElo}
					oninput={(event) => (elo = Number(event.currentTarget.value))}
				/>
				<span class="font-mono text-sm" data-testid="elo-value">{clampedElo}</span>
			{/if}
		</fieldset>

		<div class="grid">
			<label class="field">
				<span class="label">Time control</span>
				<Select
					class="h-8 text-sm"
					value={timeControl}
					onchange={(event) => (timeControl = event.currentTarget.value)}
				>
					{#each TIME_CONTROL_PRESETS as preset (timeControlLabel(preset))}
						<option value={timeControlLabel(preset)}>{timeControlLabel(preset)}</option>
					{/each}
					<option value={CUSTOM_TIME_CONTROL}>Custom</option>
				</Select>
			</label>
			{#if timeControl === CUSTOM_TIME_CONTROL}
				<label class="field">
					<span class="label">Minutes</span>
					<Input inputmode="numeric" bind:value={customMinutes} />
				</label>
				<label class="field">
					<span class="label">Increment (s)</span>
					<Input inputmode="numeric" bind:value={customIncrement} />
				</label>
			{/if}
		</div>

		<div class="grid">
			<label class="field">
				<span class="label">Engine limit per move</span>
				<Select
					class="h-8 text-sm"
					value={limitKind}
					onchange={(event) => (limitKind = event.currentTarget.value as EngineLimitKind | "none")}
				>
					<option value="none">None</option>
					{#each Object.entries(ENGINE_LIMIT_LABELS) as [kind, label] (kind)}
						<option value={kind}>{label}</option>
					{/each}
				</Select>
			</label>
			{#if limitKind !== "none"}
				<label class="field">
					<span class="label">{ENGINE_LIMIT_LABELS[limitKind]}</span>
					<Input inputmode="numeric" bind:value={limitValue} />
				</label>
			{/if}
		</div>

		<label class="choice">
			<input type="checkbox" bind:checked={ponder} />
			Ponder (think on your time)
		</label>

		{#if error}
			<Callout tone="warn" role="alert">{error}</Callout>
		{/if}

		<StartPositionPicker onselect={start} actionLabel="Start game" />
	</div>
</Dialog>

<style>
	.setup {
		display: grid;
		gap: 1rem;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 1rem;
		border: 0;
		padding: 0;
		margin: 0;
	}

	.row legend {
		float: left;
		margin-right: 0.5rem;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
		gap: 0.75rem;
	}

	.field {
		display: grid;
		gap: 0.25rem;
	}

	.label {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--fui-ink);
	}

	.choice {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.875rem;
	}

	.slider {
		flex: 1 1 10rem;
	}

	.status {
		min-height: 1.25rem;
	}
</style>
