<script lang="ts">
import { Footer, Link } from "foundationui/svelte";
import { APP_SOURCE } from "$lib/licences/source";
</script>

<Footer>
	<nav aria-label="Legal" class="flex flex-wrap gap-x-5 gap-y-1">
		<Link href={APP_SOURCE} subtle>Source (GPL-3.0)</Link>
		<Link href="/licences" subtle>Licences</Link>
	</nav>
</Footer>
