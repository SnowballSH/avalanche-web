<script lang="ts">
import { Badge, Button, Callout, Link } from "foundationui/svelte";
import { formatBytes, pinCommitUrl, pinStateLabel, shortCommit } from "./pin-format";
import type { PinRow } from "./pin-manager";

interface Props {
	row: PinRow;
	isDefault: boolean;
	ondownload: () => void;
	onremove: () => void;
	ondefault: () => void;
}

let { row, isDefault, ondownload, onremove, ondefault }: Props = $props();

const id = $derived(row.kind === "stale" ? row.id : row.pin.id);
const bytes = $derived(row.kind === "stale" ? row.bytes : row.pin.bytes);
const tone = $derived(
	row.state.kind === "ready"
		? "accent"
		: row.state.kind === "corrupt" || row.state.kind === "stale"
			? "aurora"
			: "neutral",
);
</script>

<li class="row" data-testid="pin-row" data-pin-id={id} aria-label={row.kind === "stale" ? id : row.pin.label}>
	<div class="identity">
		{#if row.kind === "catalogue"}
			<span class="label font-semibold text-ink">{row.pin.label}</span>
			<span class="meta text-sm text-ink-secondary">
				<Link href={pinCommitUrl(row.pin.commit)} external class="font-mono">
					{shortCommit(row.pin.commit)}
				</Link>
				<span data-testid="pin-date">{row.pin.date}</span>
				<span data-testid="pin-size">{formatBytes(bytes)}</span>
			</span>
		{:else}
			<span class="label font-semibold text-ink font-mono">{row.id}</span>
			<span class="meta text-sm text-ink-secondary">
				<span data-testid="pin-size">{formatBytes(bytes)}</span>
			</span>
			<span class="text-sm text-ink-secondary">
				This version is no longer offered by the site. Delete it to free {formatBytes(bytes)}.
			</span>
		{/if}
	</div>

	<div class="status">
		<Badge {tone} data-testid="pin-state">{pinStateLabel(row.state)}</Badge>
		{#if row.state.kind === "downloading"}
			<progress
				max="1"
				value={row.state.fraction}
				aria-label={`Downloading ${row.kind === "catalogue" ? row.pin.label : id}`}
			></progress>
		{/if}
	</div>

	<div class="actions">
		{#if row.kind === "catalogue"}
			<label class="default text-sm">
				<input type="radio" name="default-pin" value={id} checked={isDefault} onchange={ondefault} />
				Default
			</label>
			{#if row.state.kind === "absent" || row.state.kind === "corrupt"}
				<Button size="sm" onclick={ondownload}>Download</Button>
			{:else if row.state.kind === "downloading"}
				<Button size="sm" variant="secondary" onclick={onremove}>Cancel</Button>
			{:else}
				<Button size="sm" variant="secondary" onclick={onremove}>Delete</Button>
			{/if}
		{:else}
			<Button size="sm" variant="secondary" onclick={onremove}>Delete</Button>
		{/if}
	</div>

	{#if row.error}
		<Callout tone="warn" role="alert" class="error">{row.error}</Callout>
	{/if}
</li>

<style>
	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto;
		align-items: center;
		gap: 0.5rem 1rem;
		padding: 0.75rem 0;
		border-bottom: 1px solid var(--fui-line);
	}

	.identity {
		display: grid;
		gap: 0.25rem;
		min-width: 0;
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
	}

	.status {
		display: grid;
		justify-items: end;
		gap: 0.25rem;
	}

	.status progress {
		width: 8rem;
		accent-color: var(--fui-accent);
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.default {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
	}

	.row :global(.error) {
		grid-column: 1 / -1;
		font-size: 0.875rem;
		overflow-wrap: anywhere;
	}

	@media (max-width: 40rem) {
		.row {
			grid-template-columns: minmax(0, 1fr);
		}

		.status {
			justify-items: start;
		}
	}
</style>
