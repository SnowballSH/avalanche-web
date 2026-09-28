<script lang="ts">
import { Link, PageShell, Panel } from "foundationui/svelte";
import { notices } from "$lib/licences/notices";
import { APP_SOURCE } from "$lib/licences/source";
</script>

<svelte:head>
	<title>Licences · Avalanche</title>
</svelte:head>

<PageShell>
	<div class="licences">
		<h1 class="font-display text-2xl font-semibold text-ink">Licences</h1>

		<p class="text-sm text-ink-secondary">
			This site is free software under the GNU General Public License, version 3. Its complete
			source is at <Link href={APP_SOURCE}>{APP_SOURCE}</Link>. It is built from the works below,
			each under its own licence.
		</p>

		<ul class="notices" aria-label="Notices">
			{#each notices as notice (notice.id)}
				<li data-testid="licence-notice" data-notice-id={notice.id}>
					<Panel tier="flat">
						<div class="notice">
							<h2 class="flex flex-wrap items-baseline gap-x-2 text-base font-semibold text-ink">
								<span>{notice.name}</span>
								{#if notice.version}
									<span class="font-mono text-sm font-normal text-ink-secondary">{notice.version}</span>
								{/if}
							</h2>
							<p class="text-sm text-ink-secondary">{notice.role}</p>
							<dl class="text-sm">
								<dt class="text-ink-muted">Licence</dt>
								<dd class="font-mono text-ink">{notice.licence}</dd>
								<dt class="text-ink-muted">Copyright</dt>
								<dd class="text-ink">{notice.holder}</dd>
								<dt class="text-ink-muted">Source</dt>
								<dd><Link href={notice.source}>{notice.source}</Link></dd>
							</dl>
							{#if notice.note}
								<p class="text-sm text-ink">{notice.note}</p>
							{/if}
							{#if notice.text}
								<details>
									<summary class="cursor-pointer text-sm text-ink">Licence text</summary>
									<pre class="font-mono text-xs text-ink">{notice.text}</pre>
								</details>
							{/if}
						</div>
					</Panel>
				</li>
			{/each}
		</ul>
	</div>
</PageShell>

<style>
	.licences {
		display: grid;
		gap: 1rem;
	}

	.notices {
		display: grid;
		gap: 0.75rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.notice {
		display: grid;
		gap: 0.5rem;
		min-width: 0;
	}

	dl {
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		gap: 0.25rem 1rem;
		margin: 0;
	}

	dd {
		margin: 0;
		overflow-wrap: anywhere;
	}

	pre {
		max-height: 24rem;
		overflow: auto;
		margin: 0.5rem 0 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
</style>
