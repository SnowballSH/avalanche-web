<script lang="ts">
import type { Key } from "@lichess-org/chessground/types";
import type { Color } from "$lib/chess/types";
import { PROMOTION_ROLES, type PromotionRole } from "./moves";

interface Props {
	dest: Key;
	color: Color;
	orientation: Color;
	onpick: (role: PromotionRole) => void;
	oncancel: () => void;
}

let { dest, color, orientation, onpick, oncancel }: Props = $props();

const FILES = "abcdefgh";

let dialog = $state<HTMLElement>();

const column = $derived.by(() => {
	const file = FILES.indexOf(dest.charAt(0));
	return orientation === "white" ? file : 7 - file;
});

const stacksDownward = $derived((dest.charAt(1) === "8") === (orientation === "white"));

const row = (index: number) => (stacksDownward ? index : 7 - index);

const choices = (): HTMLButtonElement[] =>
	Array.from(dialog?.querySelectorAll<HTMLButtonElement>(".choice") ?? []);

const trapTab = (event: KeyboardEvent) => {
	const buttons = choices();
	const first = buttons[0];
	const last = buttons[buttons.length - 1];
	if (!first || !last) return;
	const active = document.activeElement;
	const index = buttons.findIndex((button) => button === active);
	if (index === -1) {
		event.preventDefault();
		first.focus();
	} else if (event.shiftKey && active === first) {
		event.preventDefault();
		last.focus();
	} else if (!event.shiftKey && active === last) {
		event.preventDefault();
		first.focus();
	}
};

const onkeydown = (event: KeyboardEvent) => {
	if (event.key === "Escape") oncancel();
	else if (event.key === "Tab") trapTab(event);
};

$effect(() => {
	choices()[0]?.focus();
});
</script>

<svelte:window {onkeydown} />

<div
	class="promotion cg-wrap"
	role="dialog"
	aria-modal="true"
	aria-label="Promote to"
	bind:this={dialog}
>
	<button
		type="button"
		class="backdrop"
		aria-label="Cancel promotion"
		tabindex="-1"
		onclick={oncancel}
	></button>
	{#each PROMOTION_ROLES as role, index (role)}
		<button
			type="button"
			class="choice"
			style={`left: ${column * 12.5}%; top: ${row(index) * 12.5}%`}
			aria-label={`Promote to ${role}`}
			onclick={() => onpick(role)}
		>
			<piece class={`${role} ${color}`}></piece>
		</button>
	{/each}
</div>

<style>
	.promotion.cg-wrap {
		position: absolute;
		inset: 0;
		z-index: 20;
	}

	.backdrop {
		position: absolute;
		inset: 0;
		border: 0;
		padding: 0;
		background: color-mix(in srgb, var(--fui-ink) 45%, transparent);
		cursor: pointer;
	}

	.choice {
		position: absolute;
		width: 12.5%;
		height: 12.5%;
		border: 0;
		padding: 0;
		border-radius: 50%;
		background: var(--fui-surface-raised);
		box-shadow: var(--fui-shadow-float-1);
		cursor: pointer;
	}

	.choice:hover,
	.choice:focus-visible {
		background: var(--fui-accent);
	}

	.choice:focus-visible {
		outline: 3px solid var(--fui-surface-base);
		outline-offset: 2px;
	}

	.choice piece {
		position: static;
		display: block;
		width: 100%;
		height: 100%;
	}
</style>
