<script lang="ts">
import type { Color as PieceColor, Role, SquareName } from "chessops";
import { Button, Callout, Input, Panel, Select } from "foundationui/svelte";
import { onMount } from "svelte";
import { goto } from "$app/navigation";
import Board from "$lib/board/Board.svelte";
import type { BoardEditing } from "$lib/board/moves";
import type { Color } from "$lib/chess/types";
import {
	applyTool,
	CASTLING_RIGHTS,
	type CastlingRight,
	clearBoard,
	type EditorState,
	type EditorTool,
	editorFen,
	editorFromFen,
	editorLinks,
	enPassantCandidates,
	FEN_QUERY_PARAM,
	startingEditor,
	validateEditor,
	withCastling,
	withEnPassant,
	withPlacement,
	withTurn,
} from "$lib/editor/editor-state";

const ROLES: readonly Role[] = ["king", "queen", "rook", "bishop", "knight", "pawn"];

const CASTLING_LABELS: Readonly<Record<CastlingRight, string>> = {
	K: "White O-O",
	Q: "White O-O-O",
	k: "Black O-O",
	q: "Black O-O-O",
};

const SIDES: readonly Color[] = ["white", "black"];

const MOVE_TOOL: EditorTool = { kind: "move" };
const ERASE_TOOL: EditorTool = { kind: "erase" };

let editor = $state.raw<EditorState>(startingEditor());
let tool = $state.raw<EditorTool>(MOVE_TOOL);
let orientation = $state<Color>("white");
let fenText = $state("");
let loadError = $state<string | null>(null);

const fen = $derived(editorFen(editor));
const validation = $derived(validateEditor(editor));
const candidates = $derived(enPassantCandidates(editor));

$effect(() => {
	fenText = fen;
});

const isTool = (candidate: EditorTool): boolean =>
	candidate.kind === tool.kind &&
	(candidate.kind !== "piece" ||
		(tool.kind === "piece" &&
			candidate.piece.role === tool.piece.role &&
			candidate.piece.color === tool.piece.color));

const pieceTool = (color: PieceColor, role: Role): EditorTool => ({
	kind: "piece",
	piece: { color, role },
});

const editing: BoardEditing = {
	onpress: (square) => {
		if (tool.kind === "move" || square === "a0") return false;
		editor = applyTool(editor, square as SquareName, tool);
		return true;
	},
	onchange: (placement) => {
		editor = withPlacement(editor, placement);
	},
};

const chooseEnPassant = (value: string) => {
	const square = value === "" ? null : candidates.find((candidate) => candidate === value);
	editor = withEnPassant(editor, square ?? null);
};

const load = (text: string): boolean => {
	const loaded = editorFromFen(text);
	if (!loaded.ok) {
		loadError = loaded.error.message;
		return false;
	}
	editor = loaded.value;
	loadError = null;
	return true;
};

const submitFen = (event: SubmitEvent) => {
	event.preventDefault();
	load(fenText);
};

const reset = (next: EditorState) => {
	editor = next;
	loadError = null;
};

const open = (target: "analysis" | "play") => {
	if (validation.ok) void goto(editorLinks(validation.fen)[target]);
};

onMount(() => {
	const initial = new URLSearchParams(window.location.search).get(FEN_QUERY_PARAM);
	if (initial !== null) load(initial);
});
</script>

<svelte:head>
	<title>Board editor · Avalanche</title>
</svelte:head>

{#snippet palette(color: PieceColor)}
	<div class="palette cg-wrap" role="group" aria-label={`${color === "white" ? "White" : "Black"} pieces`}>
		{#each ROLES as role (role)}
			{@const candidate = pieceTool(color, role)}
			<button
				type="button"
				class="tool"
				aria-label={`${color === "white" ? "White" : "Black"} ${role}`}
				aria-pressed={isTool(candidate)}
				onclick={() => (tool = candidate)}
			>
				<piece class={`${role} ${color}`}></piece>
			</button>
		{/each}
	</div>
{/snippet}

<div class="editor">
	<h1 class="sr-only">Board editor</h1>

	<div class="main">
		{@render palette(orientation === "white" ? "black" : "white")}
		<Board {fen} {orientation} {editing} class="board-slot" />
		{@render palette(orientation)}
		<div class="tools" role="group" aria-label="Board tools">
			<Button
				size="sm"
				variant={tool.kind === "move" ? "primary" : "secondary"}
				aria-pressed={tool.kind === "move"}
				onclick={() => (tool = MOVE_TOOL)}
			>
				Move
			</Button>
			<Button
				size="sm"
				variant={tool.kind === "erase" ? "primary" : "secondary"}
				aria-pressed={tool.kind === "erase"}
				onclick={() => (tool = ERASE_TOOL)}
			>
				Erase
			</Button>
			<Button size="sm" variant="secondary" onclick={() => reset(startingEditor())}>
				Start position
			</Button>
			<Button size="sm" variant="secondary" onclick={() => reset(clearBoard(editor))}>
				Clear board
			</Button>
			<Button
				size="sm"
				variant="secondary"
				onclick={() => (orientation = orientation === "white" ? "black" : "white")}
			>
				Flip
			</Button>
		</div>
	</div>

	<aside class="side">
		<Panel tier="flat" class="settings">
			<fieldset class="group">
				<legend class="text-sm font-semibold text-ink">Side to move</legend>
				{#each SIDES as side (side)}
					<label class="option">
						<input
							type="radio"
							name="turn"
							value={side}
							checked={editor.turn === side}
							onchange={() => (editor = withTurn(editor, side))}
						/>
						{side === "white" ? "White" : "Black"}
					</label>
				{/each}
			</fieldset>

			<fieldset class="group">
				<legend class="text-sm font-semibold text-ink">Castling</legend>
				{#each CASTLING_RIGHTS as right (right)}
					<label class="option">
						<input
							type="checkbox"
							checked={editor.castling[right]}
							onchange={(event) =>
								(editor = withCastling(editor, right, event.currentTarget.checked))}
						/>
						{CASTLING_LABELS[right]}
					</label>
				{/each}
			</fieldset>

			<label class="group">
				<span class="text-sm font-semibold text-ink">En passant</span>
				<Select
					value={editor.enPassant ?? ""}
					onchange={(event) => chooseEnPassant(event.currentTarget.value)}
				>
					<option value="">None</option>
					{#if editor.enPassant !== null && !candidates.includes(editor.enPassant)}
						<option value={editor.enPassant}>{editor.enPassant}</option>
					{/if}
					{#each candidates as square (square)}
						<option value={square}>{square}</option>
					{/each}
				</Select>
			</label>
		</Panel>

		<Panel tier="flat" class="settings">
			<form class="fen-form" aria-label="Load a FEN" onsubmit={submitFen}>
				<label class="group">
					<span class="text-sm font-semibold text-ink">FEN</span>
					<Input
						class="fen"
						spellcheck="false"
						autocomplete="off"
						data-testid="editor-fen"
						bind:value={fenText}
					/>
				</label>
				<div>
					<Button type="submit" size="sm" variant="secondary">Load FEN</Button>
				</div>
			</form>
			{#if loadError}
				<Callout tone="warn" role="alert" class="message">{loadError}</Callout>
			{/if}
		</Panel>

		<Panel tier="flat" class="settings">
			<div class="actions">
				<Button
					size="sm"
					disabled={!validation.ok}
					aria-describedby="editor-validation"
					onclick={() => open("analysis")}
				>
					Analyse
				</Button>
				<Button
					size="sm"
					variant="secondary"
					disabled={!validation.ok}
					aria-describedby="editor-validation"
					onclick={() => open("play")}
				>
					Play from here
				</Button>
			</div>
			<p id="editor-validation" class="message" role="status" data-testid="editor-validation">
				{#if !validation.ok}
					{validation.reason}
				{:else if validation.normalised}
					Legal position. It will open as <span class="font-mono">{validation.fen}</span>
				{:else}
					Legal position.
				{/if}
			</p>
		</Panel>
	</aside>
</div>

<style>
	.editor {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(18rem, 26rem);
		gap: 1rem;
		max-width: 80rem;
		margin: 0 auto;
		padding: 1rem;
	}

	.main {
		display: grid;
		gap: 0.5rem;
		align-content: start;
		width: min(100%, 40rem);
		min-width: 0;
	}

	.palette.cg-wrap {
		display: grid;
		grid-template-columns: repeat(6, minmax(0, 1fr));
		gap: 0.25rem;
		width: 75%;
	}

	.tool {
		aspect-ratio: 1 / 1;
		border: 1px solid var(--fui-line);
		border-radius: var(--fui-radius-sm);
		padding: 0;
		background: var(--fui-surface-raised);
		cursor: pointer;
	}

	.tool[aria-pressed="true"] {
		border-color: var(--fui-accent);
		background: color-mix(in srgb, var(--fui-accent) 30%, var(--fui-surface-raised));
	}

	.tool:focus-visible {
		outline: 2px solid var(--fui-accent);
		outline-offset: 2px;
	}

	.tool piece {
		position: static;
		display: block;
		width: 100%;
		height: 100%;
	}

	.tools,
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.side {
		display: grid;
		gap: 1rem;
		align-content: start;
		min-width: 0;
	}

	.side :global(.settings) {
		display: grid;
		gap: 0.75rem;
	}

	.group {
		display: grid;
		gap: 0.375rem;
		border: 0;
		padding: 0;
		margin: 0;
	}

	.option {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		margin-right: 1rem;
		font-size: 0.875rem;
	}

	.fen-form {
		display: grid;
		gap: 0.5rem;
	}

	.fen-form :global(.fen) {
		font-family: var(--fui-font-mono);
		font-size: 0.75rem;
	}

	.message,
	.side :global(.message) {
		min-height: 1.25rem;
		font-size: 0.875rem;
		color: var(--fui-ink-secondary);
		overflow-wrap: anywhere;
	}

	@media (max-width: 60rem) {
		.editor {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
