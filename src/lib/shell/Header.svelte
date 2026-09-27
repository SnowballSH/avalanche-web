<script lang="ts">
import { Header, Link, ThemeToggle } from "foundationui/svelte";
import { page } from "$app/state";
import { navigation } from "./navigation";

const isCurrent = (href: string) =>
	page.url.pathname === href || page.url.pathname.startsWith(`${href}/`);
</script>

<Header>
	<a href="/analysis" class="font-display text-sm font-semibold tracking-wide whitespace-nowrap text-ink">
		Avalanche
	</a>
	<nav aria-label="Site" class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm sm:gap-x-5">
		{#each navigation as item (item.href)}
			<Link
				href={item.href}
				subtle={!isCurrent(item.href)}
				aria-current={isCurrent(item.href) ? "page" : undefined}
			>
				{item.label}
			</Link>
		{/each}
		<ThemeToggle />
	</nav>
</Header>
