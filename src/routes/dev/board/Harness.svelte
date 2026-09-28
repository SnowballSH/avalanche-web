<script lang="ts">
import type { DrawShape } from "@lichess-org/chessground/draw";
import { makeFen } from "chessops/fen";
import { parseUci } from "chessops/util";
import { Button, Select } from "foundationui/svelte";
import Board from "$lib/board/Board.svelte";
import EvalBar from "$lib/board/EvalBar.svelte";
import EvalGraph from "$lib/board/EvalGraph.svelte";
import type { PovScore } from "$lib/board/eval";
import { legalDests } from "$lib/board/moves";
import { bestMoveArrow } from "$lib/board/shapes";
import { positionFromFen } from "$lib/chess/fen";
import type { Color } from "$lib/chess/types";
import type { Fen, Score, UciMove } from "$lib/engine/types";

const POSITIONS = {
	start: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
	promotion: "8/4P3/8/8/8/8/8/k6K w - - 0 1",
	blackPromotion: "k6K/8/8/8/8/8/4p3/8 b - - 0 1",
	castling: "r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1",
} as const;

type PositionName = keyof typeof POSITIONS;

const BAR_SCORES = {
	"+0.35": { kind: "cp", value: 35 },
	"-10.52": { kind: "cp", value: -1052 },
	"+123.45": { kind: "cp", value: 12345 },
	"-#12": { kind: "mate", value: -12 },
	"1-0": { kind: "checkmate", winner: "white" },
} as const satisfies Record<string, PovScore>;

type BarScoreName = keyof typeof BAR_SCORES;

const GRAPH_SCORES: readonly Score[] = [
	{ kind: "cp", value: 20 },
	{ kind: "cp", value: 60 },
	{ kind: "cp", value: -150 },
	{ kind: "cp", value: 40 },
	{ kind: "mate", value: 3 },
];

let position = $state<PositionName>("start");
let barScore = $state<BarScoreName>("+0.35");
let chess960 = $state(false);
let orientation = $state<Color>("white");
let fen = $state<Fen>(POSITIONS.start);
let lastMove = $state<UciMove | null>(null);
let moves = $state<UciMove[]>([]);
let premoves = $state<string[]>([]);
let drawn = $state<string[]>([]);
let selected = $state<number | null>(null);

const movable = $derived({ color: "both" as const, dests: legalDests(fen, chess960) });
const arrow = $derived(bestMoveArrow(["g1f3"]));
const shapes = $derived(position === "start" && arrow ? [arrow] : []);

const choosePosition = (name: PositionName) => {
	position = name;
	fen = POSITIONS[name];
	lastMove = null;
};

const play = (uci: UciMove) => {
	const move = parseUci(uci);
	if (!move) return;
	const next = positionFromFen(fen);
	next.play(move);
	fen = makeFen(next.toSetup());
	lastMove = uci;
	moves = [...moves, uci];
};

const recordShapes = (list: readonly DrawShape[]) => {
	drawn = list.map((shape) => `${shape.orig}${shape.dest ?? ""}`);
};
</script>

<div class="harness">
	<div class="controls">
		<Select
			aria-label="Position"
			value={position}
			onchange={(event) => choosePosition(event.currentTarget.value as PositionName)}
		>
			{#each Object.keys(POSITIONS) as name (name)}
				<option value={name}>{name}</option>
			{/each}
		</Select>
		<Select
			aria-label="Bar score"
			value={barScore}
			onchange={(event) => (barScore = event.currentTarget.value as BarScoreName)}
		>
			{#each Object.keys(BAR_SCORES) as name (name)}
				<option value={name}>{name}</option>
			{/each}
		</Select>
		<label class="toggle">
			<input type="checkbox" bind:checked={chess960} />
			Chess960
		</label>
		<Button
			variant="secondary"
			size="sm"
			onclick={() => (orientation = orientation === "white" ? "black" : "white")}
		>
			Flip
		</Button>
	</div>
	<div class="stage">
		<EvalBar score={BAR_SCORES[barScore]} {orientation} />
		<Board
			{fen}
			{orientation}
			{movable}
			{lastMove}
			{shapes}
			{chess960}
			onmove={play}
			onpremove={(uci) => (premoves = [...premoves, uci ?? "none"])}
			onshapes={recordShapes}
			class="board-slot"
		/>
	</div>
	<EvalGraph scores={GRAPH_SCORES} current={selected ?? 0} onselect={(index) => (selected = index)} />
	<dl class="log">
		<dt>fen</dt>
		<dd><output data-testid="fen">{fen}</output></dd>
		<dt>moves</dt>
		<dd><output data-testid="moves">{moves.join(" ")}</output></dd>
		<dt>premoves</dt>
		<dd><output data-testid="premoves">{premoves.join(" ")}</output></dd>
		<dt>shapes</dt>
		<dd><output data-testid="shapes">{drawn.join(" ")}</output></dd>
		<dt>selected</dt>
		<dd><output data-testid="selected">{selected ?? ""}</output></dd>
	</dl>
</div>

<style>
	.harness {
		display: grid;
		gap: 1rem;
		max-width: 32rem;
		padding: 1rem;
	}

	.controls,
	.toggle {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.stage {
		display: flex;
		gap: 0.5rem;
		height: 24rem;
	}

	.stage :global(.board-slot) {
		width: 24rem;
	}

	.log {
		font-family: var(--fui-font-mono);
		font-size: 0.75rem;
	}
</style>
