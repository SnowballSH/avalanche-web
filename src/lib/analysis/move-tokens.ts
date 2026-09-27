import type { GameTree, NodeId } from "$lib/chess/types";

interface Bracket {
	readonly kind: "open" | "close";
	readonly depth: number;
}

export type MoveToken =
	| { readonly kind: "move"; readonly id: NodeId; readonly label: string; readonly depth: number }
	| Bracket;

type Task =
	| {
			readonly kind: "line";
			readonly parent: NodeId;
			readonly numbered: boolean;
			readonly depth: number;
	  }
	| {
			readonly kind: "move";
			readonly id: NodeId;
			readonly numbered: boolean;
			readonly depth: number;
	  }
	| Bracket;

const moveLabel = (tree: GameTree, id: NodeId, numbered: boolean): string => {
	const node = tree.node(id);
	const [, turn, , , , fullmove] = tree.fenAt(node.parent ?? tree.root).split(" ");
	if (turn === "w") return `${fullmove}. ${node.san}`;
	return numbered ? `${fullmove}… ${node.san}` : `${node.san}`;
};

export const moveTokens = (tree: GameTree): MoveToken[] => {
	const tokens: MoveToken[] = [];
	const tasks: Task[] = [{ kind: "line", parent: tree.root, numbered: true, depth: 0 }];
	for (let task = tasks.pop(); task !== undefined; task = tasks.pop()) {
		if (task.kind === "move") {
			tokens.push({
				kind: "move",
				id: task.id,
				label: moveLabel(tree, task.id, task.numbered),
				depth: task.depth,
			});
		} else if (task.kind === "line") {
			const [main, ...variations] = tree.children(task.parent);
			if (main === undefined) continue;
			const { depth } = task;
			const pending: Task[] = [{ kind: "move", id: main, numbered: task.numbered, depth }];
			for (const variation of variations) {
				pending.push(
					{ kind: "open", depth: depth + 1 },
					{ kind: "move", id: variation, numbered: true, depth: depth + 1 },
					{ kind: "line", parent: variation, numbered: false, depth: depth + 1 },
					{ kind: "close", depth: depth + 1 },
				);
			}
			pending.push({ kind: "line", parent: main, numbered: variations.length > 0, depth });
			tasks.push(...pending.reverse());
		} else {
			tokens.push(task);
		}
	}
	return tokens;
};
