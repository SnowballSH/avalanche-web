<script lang="ts">
import { Callout, PageShell, Panel, Spinner } from "foundationui/svelte";
import { onMount } from "svelte";
import { getDefaultPin, setDefaultPin } from "$lib/pins/default-pin";
import PinRow from "$lib/pins/PinRow.svelte";
import { formatUsage } from "$lib/pins/pin-format";
import { PinManager, type PinManagerState } from "$lib/pins/pin-manager";
import { browserEngineRuntime } from "$lib/shared/engine-runtime";

let manager = $state.raw<PinManager | null>(null);
let view = $state.raw<PinManagerState | null>(null);

const rowKey = (row: PinManagerState["rows"][number]): string =>
	row.kind === "stale" ? `stale:${row.id}:${row.sha256}` : row.pin.id;

onMount(() => {
	const runtime = browserEngineRuntime();
	const created = new PinManager({
		store: runtime.pins,
		catalogue: () => runtime.catalogue(),
		defaults: { getDefaultPin, setDefaultPin },
	});
	manager = created;
	const unsubscribe = created.subscribe((state) => {
		view = state;
	});
	void created.load();
	return unsubscribe;
});
</script>

<svelte:head>
	<title>Engines · Avalanche</title>
</svelte:head>

<PageShell>
	<div class="engines">
		<h1 class="font-display text-2xl font-semibold text-ink">Engines</h1>

		<p class="text-sm text-ink-secondary">
			Each Avalanche version runs in your browser from a copy downloaded into this site's storage.
			Browsers may clear that storage: Safari does after seven days without a visit, and any
			browser can when space runs low. A cleared version shows as not downloaded and downloads
			again when you next use it.
		</p>

		{#if view === null || view.status === "loading"}
			<p class="loading text-sm text-ink-secondary"><Spinner size="sm" /> Loading engine versions…</p>
		{:else}
			{#if view.message}
				<Callout tone="warn" role="alert">{view.message}</Callout>
			{/if}
			{#if view.usage}
				<p class="text-sm text-ink" data-testid="storage-usage">
					{formatUsage(view.usage)}
				</p>
			{/if}
			{#if view.rows.length > 0}
				<Panel tier="flat">
					<ul class="rows" aria-label="Engine versions">
						{#each view.rows as row (rowKey(row))}
							<PinRow
								{row}
								isDefault={row.kind === "catalogue" && row.pin.id === view.defaultId}
								ondownload={() => row.kind === "catalogue" && void manager?.download(row.pin.id)}
								onremove={() => void manager?.remove(row.kind === "stale" ? row.id : row.pin.id)}
								ondefault={() => row.kind === "catalogue" && manager?.setDefault(row.pin.id)}
							/>
						{/each}
					</ul>
				</Panel>
			{/if}
		{/if}
	</div>
</PageShell>

<style>
	.engines {
		display: grid;
		gap: 1rem;
	}

	.loading {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}

	.rows {
		display: grid;
		margin: 0;
		padding: 0;
		list-style: none;
	}
</style>
