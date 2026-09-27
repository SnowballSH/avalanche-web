<script lang="ts">
import { Button, Callout, Select } from "foundationui/svelte";
import { parseFen } from "$lib/chess/fen";
import { importPgn } from "$lib/chess/pgn";
import type { ImportError, ImportedGame } from "$lib/chess/types";
import type { Fen } from "$lib/engine/types";
import type { AnalysisController } from "./controller";
import { analysisLink } from "./hash-link";

interface Props {
	controller: AnalysisController;
	fen: Fen;
	oncopy: (text: string, what: string) => void;
}

let { controller, fen, oncopy }: Props = $props();

const MAX_FEN_LENGTH = 256;

const looksLikeFen = (input: string): boolean => {
	const trimmed = input.trim();
	return trimmed.length <= MAX_FEN_LENGTH && !/[\n[]/.test(trimmed) && trimmed.includes("/");
};

let text = $state("");
let games = $state.raw<readonly ImportedGame[]>([]);
let picked = $state(0);
let error = $state<string | null>(null);
let info = $state<string | null>(null);
let withEvals = $state(true);
let exported = $state<string | null>(null);

const describe = (failure: ImportError): string => failure.message;

const gameLabel = (game: ImportedGame, index: number): string => {
	const white = game.headers.get("White") ?? "?";
	const black = game.headers.get("Black") ?? "?";
	const event = game.headers.get("Event");
	const suffix = event && event !== "?" ? ` (${event})` : "";
	return `${index + 1}. ${white} – ${black}${suffix}`;
};

const reset = () => {
	error = null;
	info = null;
};

const openGame = (game: ImportedGame) => {
	const loaded = controller.load(game);
	if (!loaded.ok) {
		error = describe(loaded.error);
		return;
	}
	games = [];
	info = "Game imported";
};

const importFen = (input: string) => {
	const parsed = parseFen(input);
	if (!parsed.ok) {
		error = describe(parsed.error);
		return;
	}
	const loaded = controller.load({ kind: "fen", fen: parsed.value.fen });
	if (!loaded.ok) {
		error = describe(loaded.error);
		return;
	}
	info = parsed.value.fen === input.trim() ? "Position loaded" : `Loaded as ${parsed.value.fen}`;
};

const importText = () => {
	reset();
	games = [];
	if (text.trim().length === 0) {
		error = "Paste a FEN or a PGN first";
		return;
	}
	if (looksLikeFen(text)) {
		importFen(text);
		return;
	}
	const imported = importPgn(text);
	if (!imported.ok) {
		error = describe(imported.error);
		return;
	}
	const [first] = imported.value;
	if (imported.value.length === 1 && first) {
		openGame(first);
		return;
	}
	games = imported.value;
	picked = 0;
	info = `${imported.value.length} games found: pick one to open`;
};

const openPicked = () => {
	reset();
	const game = games[picked];
	if (game) openGame(game);
};

const exportPgn = () => {
	exported = controller.exportPgn(withEvals);
};

const copyLink = () => {
	oncopy(new URL(analysisLink(fen), window.location.origin).href, "Link");
};
</script>

<section class="import-export" aria-label="Import and export">
	<div class="block">
		<label class="field">
			<span class="text-sm font-semibold text-ink">Paste a FEN or a PGN</span>
			<textarea
				class="text"
				rows="4"
				spellcheck="false"
				autocomplete="off"
				aria-label="FEN or PGN to import"
				bind:value={text}
			></textarea>
		</label>
		<div class="row">
			<Button size="sm" onclick={importText}>Import</Button>
		</div>
		{#if games.length > 1}
			<div class="row">
				<Select
					class="h-8 text-sm"
					aria-label="Game to open"
					value={String(picked)}
					onchange={(event) => (picked = Number(event.currentTarget.value))}
				>
					{#each games as game, index (index)}
						<option value={String(index)}>{gameLabel(game, index)}</option>
					{/each}
				</Select>
				<Button size="sm" variant="secondary" onclick={openPicked}>Open game</Button>
			</div>
		{/if}
		{#if error}
			<Callout tone="warn" role="alert" data-testid="import-error">{error}</Callout>
		{/if}
		{#if info}
			<p class="info text-sm text-ink-secondary" role="status">{info}</p>
		{/if}
	</div>

	<div class="block">
		<div class="row">
			<label class="check text-sm">
				<input type="checkbox" bind:checked={withEvals} />
				Include evaluations
			</label>
			<Button size="sm" variant="secondary" onclick={exportPgn}>Export PGN</Button>
			<Button size="sm" variant="secondary" onclick={() => oncopy(fen, "FEN")}>Copy FEN</Button>
			<Button size="sm" variant="secondary" onclick={copyLink}>Copy link</Button>
		</div>
		{#if exported !== null}
			<textarea class="text" rows="6" readonly aria-label="Exported PGN" value={exported}></textarea>
			<div class="row">
				<Button size="sm" variant="secondary" onclick={() => oncopy(exported ?? "", "PGN")}>
					Copy PGN
				</Button>
			</div>
		{/if}
	</div>
</section>

<style>
	.import-export {
		display: grid;
		gap: 1rem;
	}

	.block,
	.field {
		display: grid;
		gap: 0.5rem;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}

	.text {
		width: 100%;
		padding: 0.5rem;
		border: 1px solid var(--fui-line);
		border-radius: var(--fui-radius-sm);
		background: var(--fui-surface-raised);
		color: var(--fui-ink);
		font-family: var(--fui-font-mono);
		font-size: 0.75rem;
		resize: vertical;
	}

	.check {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
	}

	.info {
		overflow-wrap: anywhere;
	}
</style>
