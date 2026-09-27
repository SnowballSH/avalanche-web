<script lang="ts">
const harness = __BOARD_HARNESS__ ? import("./Harness.svelte") : undefined;
</script>

<svelte:head>
	<title>Board harness · Avalanche</title>
</svelte:head>

{#if harness}
	{#await harness then { default: Harness }}
		<Harness />
	{/await}
{/if}
