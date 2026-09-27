<script lang="ts">
import { Chessground } from "@lichess-org/chessground";
import type { Api } from "@lichess-org/chessground/api";
import type { Config } from "@lichess-org/chessground/config";
import type { DrawShape } from "@lichess-org/chessground/draw";
import type { Key, MoveMetadata } from "@lichess-org/chessground/types";
import "@lichess-org/chessground/assets/chessground.base.css";
import "@lichess-org/chessground/assets/chessground.brown.css";
import "@lichess-org/chessground/assets/chessground.cburnett.css";
import "./board.css";
import { untrack } from "svelte";
import type { Color } from "$lib/chess/types";
import type { Fen, UciMove } from "$lib/engine/types";
import { type BoardMovable, isPromotion, moveUci, type PromotionRole, turnOf } from "./moves";
import PromotionPicker from "./PromotionPicker.svelte";
import { lastMoveKeys } from "./shapes";

interface Props {
	fen: Fen;
	orientation?: Color;
	movable?: BoardMovable;
	lastMove?: UciMove | null;
	check?: boolean;
	shapes?: readonly DrawShape[];
	premovable?: boolean;
	chess960?: boolean;
	coordinates?: boolean;
	onmove?: (uci: UciMove) => void;
	onpremove?: (uci: UciMove | null) => void;
	onshapes?: (shapes: readonly DrawShape[]) => void;
	class?: string;
}

let {
	fen,
	orientation = "white",
	movable,
	lastMove = null,
	check = false,
	shapes = [],
	premovable = false,
	chess960 = false,
	coordinates = true,
	onmove,
	onpremove,
	onshapes,
	class: className = "",
}: Props = $props();

let root = $state<HTMLElement>();
let api: Api | undefined;
let promotion = $state<{ orig: Key; dest: Key } | null>(null);

const turn = $derived(turnOf(fen));

const positionConfig = (): Config => ({
	fen,
	turnColor: turn,
	lastMove: lastMoveKeys(lastMove) ?? [],
	check,
});

const movableConfig = (): Config => {
	const active = movable !== undefined && (movable.color === "both" || movable.color === turn);
	return {
		movable: {
			color: movable?.color ?? "both",
			dests: active && movable ? movable.dests : new Map(),
		},
		premovable: { enabled: premovable && movable !== undefined },
	};
};

const syncConfig = (): Config => ({ ...positionConfig(), ...movableConfig() });

const emitMove = (orig: Key, dest: Key, role?: PromotionRole) => {
	const before = fen;
	onmove?.(moveUci(before, orig, dest, chess960, role));
	if (fen === before) api?.set(syncConfig());
};

const afterMove = (orig: Key, dest: Key, metadata: MoveMetadata) => {
	if (!isPromotion(fen, orig, dest)) {
		emitMove(orig, dest);
	} else if (metadata.premove) {
		emitMove(orig, dest, "queen");
	} else {
		promotion = { orig, dest };
	}
};

const pickPromotion = (role: PromotionRole) => {
	const pending = promotion;
	promotion = null;
	if (pending) emitMove(pending.orig, pending.dest, role);
};

const cancelPromotion = () => {
	promotion = null;
	api?.set(syncConfig());
};

const initialConfig = (): Config => {
	const { movable: movableState, premovable: premovableState } = movableConfig();
	return {
		...positionConfig(),
		orientation,
		coordinates,
		disableContextMenu: true,
		movable: { ...movableState, free: false, events: { after: afterMove } },
		premovable: {
			...premovableState,
			events: {
				set: (orig, dest) => onpremove?.(`${orig}${dest}`),
				unset: () => onpremove?.(null),
			},
		},
		drawable: {
			autoShapes: [...shapes],
			onChange: (drawn) => onshapes?.(drawn),
		},
	};
};

$effect(() => {
	if (!root) return;
	const element = root;
	const board = Chessground(element, untrack(initialConfig));
	api = board;
	const resize = new ResizeObserver(() =>
		document.body.dispatchEvent(new Event("chessground.resize")),
	);
	resize.observe(element);
	return () => {
		resize.disconnect();
		board.destroy();
		api = undefined;
	};
});

let appliedFen: Fen | undefined;

$effect(() => {
	const config = syncConfig();
	const { fen: _, ...withoutFen } = config;
	api?.set(fen === appliedFen ? withoutFen : config);
	appliedFen = fen;
});

$effect(() => {
	api?.set({ orientation });
});

$effect(() => {
	api?.setAutoShapes([...shapes]);
});

export const playPremove = (): boolean => api?.playPremove() ?? false;

export const cancelPremove = (): void => api?.cancelPremove();
</script>

<div class={`board ${className}`}>
	<div class="cg-wrap" bind:this={root}></div>
	{#if promotion}
		<PromotionPicker
			dest={promotion.dest}
			color={turn}
			{orientation}
			onpick={pickPromotion}
			oncancel={cancelPromotion}
		/>
	{/if}
</div>

<style>
	.board {
		position: relative;
		width: 100%;
	}
</style>
