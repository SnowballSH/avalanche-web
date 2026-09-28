import { turnOf } from "$lib/board/moves";
import { createGameTree, IllegalMoveError, InvalidStartError } from "$lib/chess/tree";
import type { Color, GameTree, StartPosition } from "$lib/chess/types";
import type { UciMove } from "$lib/engine/types";

export const replayGame = (start: StartPosition, moves: readonly UciMove[]): GameTree | null => {
	try {
		const tree = createGameTree(start);
		let node = tree.root;
		for (const move of moves) node = tree.addMove(node, move);
		return tree;
	} catch (error) {
		if (error instanceof IllegalMoveError || error instanceof InvalidStartError) return null;
		throw error;
	}
};

export const sideToMove = (tree: GameTree): Color =>
	turnOf(tree.fenAt(tree.mainline().at(-1) ?? tree.root));
