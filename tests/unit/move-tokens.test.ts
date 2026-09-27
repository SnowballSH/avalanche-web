import { describe, expect, it } from "vitest";
import { moveTokens } from "../../src/lib/analysis/move-tokens";
import { createGameTree } from "../../src/lib/chess/tree";

const render = (tokens: ReturnType<typeof moveTokens>): string =>
	tokens
		.map((token) => (token.kind === "move" ? token.label : token.kind === "open" ? "(" : ")"))
		.join(" ");

describe("moveTokens", () => {
	it("numbers the main line and nests variations in parentheses", () => {
		const tree = createGameTree({ kind: "standard" });
		const e4 = tree.addMove(tree.root, "e2e4");
		const e5 = tree.addMove(e4, "e7e5");
		const c5 = tree.addMove(e4, "c7c5");
		tree.addMove(c5, "g1f3");
		tree.addMove(e5, "g1f3");
		tree.addMove(tree.root, "d2d4");
		expect(render(moveTokens(tree))).toBe("1. e4 ( 1. d4 ) 1… e5 ( 1… c5 2. Nf3 ) 2. Nf3");
	});

	it("records the nesting depth of each token", () => {
		const tree = createGameTree({ kind: "standard" });
		const e4 = tree.addMove(tree.root, "e2e4");
		tree.addMove(e4, "e7e5");
		const c5 = tree.addMove(e4, "c7c5");
		const d4 = tree.addMove(c5, "d2d4");
		tree.addMove(c5, "g1f3");
		tree.addMove(d4, "c5d4");
		expect(moveTokens(tree).map((token) => token.depth)).toEqual([0, 0, 1, 1, 1, 2, 2, 2, 1, 1]);
	});

	it("starts a black-to-move FEN with an ellipsis", () => {
		const tree = createGameTree({ kind: "fen", fen: "4k3/8/8/8/8/8/4P3/4K3 b - - 0 7" });
		const kd7 = tree.addMove(tree.root, "e8d7");
		tree.addMove(kd7, "e2e4");
		expect(render(moveTokens(tree))).toBe("7… Kd7 8. e4");
	});
});
