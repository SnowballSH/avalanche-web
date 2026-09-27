import { describe, expect, it } from "vitest";
import { createGameTree, IllegalMoveError, InvalidStartError } from "../../src/lib/chess/tree";
import type { GameTree } from "../../src/lib/chess/types";
import type { SearchInfo } from "../../src/lib/engine/types";

const STANDARD_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

type IdsFor<M extends readonly string[]> = { [K in keyof M]: number };

const playLine = <const M extends readonly string[]>(
	tree: GameTree,
	from: number,
	moves: M,
): IdsFor<M> => {
	const ids: number[] = [];
	let parent = from;
	for (const move of moves) {
		parent = tree.addMove(parent, move);
		ids.push(parent);
	}
	return ids as IdsFor<M>;
};

const sanLine = (tree: GameTree, ids: readonly number[]): (string | null)[] =>
	ids.map((id) => tree.sanAt(id));

describe("createGameTree", () => {
	it("starts with a root holding the start position and no move", () => {
		const tree = createGameTree({ kind: "standard" });
		const root = tree.node(tree.root);
		expect(root.parent).toBeNull();
		expect(root.move).toBeNull();
		expect(root.san).toBeNull();
		expect(root.ply).toBe(0);
		expect(root.fen).toBe(STANDARD_FEN);
		expect(tree.mainline()).toEqual([tree.root]);
		expect(tree.children(tree.root)).toEqual([]);
	});

	it("starts from a FEN and from a Scharnagl number", () => {
		const fen = "8/8/8/4k3/8/8/4K3/4R3 w - - 5 40";
		expect(createGameTree({ kind: "fen", fen }).fenAt(0)).toBe(fen);
		expect(createGameTree({ kind: "frc", scharnagl: 518 }).fenAt(0)).toBe(STANDARD_FEN);
		expect(createGameTree({ kind: "frc", scharnagl: 0 }).fenAt(0)).toBe(
			"bbqnnrkr/pppppppp/8/8/8/8/PPPPPPPP/BBQNNRKR w KQkq - 0 1",
		);
	});

	it("rejects an invalid FEN start with a typed error and a Scharnagl number out of range", () => {
		expect(() => createGameTree({ kind: "fen", fen: "not a fen" })).toThrowError(
			expect.objectContaining({
				name: "InvalidStartError",
				error: expect.objectContaining({ kind: "invalid-fen" }),
			}),
		);
		expect(() => createGameTree({ kind: "fen", fen: "not a fen" })).toThrow(InvalidStartError);
		expect(() => createGameTree({ kind: "frc", scharnagl: 960 })).toThrow(RangeError);
	});

	it("rejects a fen start whose castling rights need Chess960 rules", () => {
		const fen = "bbqnnrkr/pppppppp/8/8/8/8/PPPPPPPP/BBQNNRKR w KQkq - 0 1";
		expect(() => createGameTree({ kind: "fen", fen })).toThrowError(
			expect.objectContaining({
				name: "InvalidStartError",
				error: expect.objectContaining({ kind: "unsupported-variant" }),
			}),
		);
		const noRights = "bbqnnrkr/pppppppp/8/8/8/8/PPPPPPPP/BBQNNRKR w - - 0 1";
		expect(createGameTree({ kind: "fen", fen: noRights }).fenAt(0)).toBe(noRights);
	});
});

describe("GameTree.addMove", () => {
	it("adds a legal move with its SAN, FEN and ply", () => {
		const tree = createGameTree({ kind: "standard" });
		const id = tree.addMove(tree.root, "e2e4");
		const node = tree.node(id);
		expect(node.parent).toBe(tree.root);
		expect(node.ply).toBe(1);
		expect(node.move).toBe("e2e4");
		expect(node.san).toBe("e4");
		expect(node.fen).toBe("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1");
		expect(tree.mainline()).toEqual([tree.root, id]);
	});

	it("returns the existing child for a repeated move instead of duplicating it", () => {
		const tree = createGameTree({ kind: "standard" });
		const first = tree.addMove(tree.root, "e2e4");
		const again = tree.addMove(tree.root, "e2e4");
		expect(again).toBe(first);
		expect(tree.children(tree.root)).toEqual([first]);
	});

	it("keeps transpositions as distinct nodes under different parents", () => {
		const tree = createGameTree({ kind: "standard" });
		const [, , a] = playLine(tree, tree.root, ["e2e4", "e7e5", "g1f3"]);
		const [, , b] = playLine(tree, tree.root, ["g1f3", "e7e5", "e2e4"]);
		expect(a).not.toBe(b);
		expect(tree.fenAt(a).split(" ").slice(0, 4)).toEqual(tree.fenAt(b).split(" ").slice(0, 4));
		expect(tree.fenAt(a)).not.toBe(tree.fenAt(b));
	});

	it("throws IllegalMoveError with the fen and uci and leaves the tree unchanged", () => {
		const tree = createGameTree({ kind: "standard" });
		expect(() => tree.addMove(tree.root, "e2e5")).toThrowError(
			expect.objectContaining({ name: "IllegalMoveError", fen: STANDARD_FEN, uci: "e2e5" }),
		);
		expect(() => tree.addMove(tree.root, "garbage")).toThrow(IllegalMoveError);
		expect(tree.children(tree.root)).toEqual([]);
	});

	it("throws on an unknown parent", () => {
		const tree = createGameTree({ kind: "standard" });
		expect(() => tree.addMove(99, "e2e4")).toThrow();
	});

	it("writes promotion SAN and disambiguates by file and by rank", () => {
		const promotion = createGameTree({ kind: "fen", fen: "8/1P4k1/8/8/8/8/8/K7 w - - 0 1" });
		const queen = promotion.addMove(promotion.root, "b7b8q");
		expect(promotion.node(queen)).toMatchObject({ move: "b7b8q", san: "b8=Q" });
		expect(promotion.fenAt(queen)).toBe("1Q6/6k1/8/8/8/8/8/K7 b - - 0 1");

		const knights = createGameTree({ kind: "fen", fen: "4k3/8/8/8/8/8/N3N3/4K3 w - - 0 1" });
		expect(knights.sanAt(knights.addMove(knights.root, "a2c3"))).toBe("Nac3");

		const rooks = createGameTree({ kind: "fen", fen: "k7/8/8/4R3/8/8/8/4RK2 w - - 0 1" });
		expect(rooks.sanAt(rooks.addMove(rooks.root, "e1e2"))).toBe("R1e2");
	});

	it("stores standard castling as the king's destination and accepts both UCI forms", () => {
		const tree = createGameTree({ kind: "standard" });
		const [, , , , , last] = playLine(tree, tree.root, [
			"e2e4",
			"e7e5",
			"g1f3",
			"b8c6",
			"f1c4",
			"g8f6",
		]);
		const viaKingSquare = tree.addMove(last, "e1g1");
		expect(tree.node(viaKingSquare).move).toBe("e1g1");
		expect(tree.sanAt(viaKingSquare)).toBe("O-O");
		expect(tree.addMove(last, "e1h1")).toBe(viaKingSquare);
	});

	it("stores FRC castling as king-takes-rook", () => {
		const tree = createGameTree({ kind: "frc", scharnagl: 518 });
		const [, , , , , last] = playLine(tree, tree.root, [
			"e2e4",
			"e7e5",
			"g1f3",
			"b8c6",
			"f1c4",
			"g8f6",
		]);
		const castle = tree.addMove(last, "e1g1");
		expect(tree.node(castle).move).toBe("e1h1");
		expect(tree.sanAt(castle)).toBe("O-O");
		expect(tree.addMove(last, "e1h1")).toBe(castle);
	});

	it("castles in a Chess960 position where the king does not move two squares", () => {
		const tree = createGameTree({ kind: "frc", scharnagl: 0 });
		const [, , , , , last] = playLine(tree, tree.root, [
			"g2g3",
			"g7g6",
			"f2f3",
			"f7f6",
			"f1f2",
			"f8f7",
		]);
		const castle = tree.addMove(last, "g1h1");
		expect(tree.sanAt(castle)).toBe("O-O");
		expect(tree.fenAt(castle)).toBe("bbqnn1kr/pppppr1p/5pp1/8/8/5PP1/PPPPPR1P/BBQNNRK1 b k - 3 4");
	});
});

describe("GameTree variations", () => {
	it("keeps the first child as the main line and promote makes a variation main", () => {
		const tree = createGameTree({ kind: "standard" });
		const [e4, e5, nf3] = playLine(tree, tree.root, ["e2e4", "e7e5", "g1f3"]);
		const [c5, nc3] = playLine(tree, e4, ["c7c5", "b1c3"]);
		expect(tree.mainline()).toEqual([tree.root, e4, e5, nf3]);
		expect(tree.children(e4)).toEqual([e5, c5]);

		tree.promote(nc3);
		expect(tree.children(e4)).toEqual([c5, e5]);
		expect(tree.mainline()).toEqual([tree.root, e4, c5, nc3]);
		expect(sanLine(tree, tree.mainline())).toEqual([null, "e4", "c5", "Nc3"]);
	});

	it("promote lifts every ancestor along the path", () => {
		const tree = createGameTree({ kind: "standard" });
		playLine(tree, tree.root, ["e2e4", "e7e5"]);
		const [d4, d5] = playLine(tree, tree.root, ["d2d4", "d7d5"]);
		const [, , c4] = playLine(tree, tree.root, ["d2d4", "g8f6", "c2c4"]);
		tree.promote(c4);
		expect(tree.mainline()).toEqual([tree.root, d4, tree.node(c4).parent, c4]);
		expect(tree.children(d4)[1]).toBe(d5);
	});

	it("promote on a mainline node or the root changes nothing", () => {
		const tree = createGameTree({ kind: "standard" });
		const [e4, e5] = playLine(tree, tree.root, ["e2e4", "e7e5"]);
		playLine(tree, e4, ["c7c5"]);
		tree.promote(e5);
		tree.promote(tree.root);
		expect(tree.mainline()).toEqual([tree.root, e4, e5]);
	});

	it("deleteFrom removes the subtree and deleteFrom(root) is a no-op", () => {
		const tree = createGameTree({ kind: "standard" });
		const [e4, e5, nf3] = playLine(tree, tree.root, ["e2e4", "e7e5", "g1f3"]);
		const [c5] = playLine(tree, e4, ["c7c5"]);
		tree.deleteFrom(e5);
		expect(tree.children(e4)).toEqual([c5]);
		expect(tree.mainline()).toEqual([tree.root, e4, c5]);
		expect(() => tree.node(e5)).toThrow();
		expect(() => tree.node(nf3)).toThrow();

		tree.deleteFrom(tree.root);
		expect(tree.node(tree.root).ply).toBe(0);
		expect(tree.mainline()).toEqual([tree.root, e4, c5]);
	});

	it("pathTo returns the ids from the root to the node", () => {
		const tree = createGameTree({ kind: "standard" });
		const [e4, e5] = playLine(tree, tree.root, ["e2e4", "e7e5"]);
		const [c5] = playLine(tree, e4, ["c7c5"]);
		expect(tree.pathTo(c5)).toEqual([tree.root, e4, c5]);
		expect(tree.pathTo(e5)).toEqual([tree.root, e4, e5]);
		expect(tree.pathTo(tree.root)).toEqual([tree.root]);
	});
});

describe("GameTree annotations", () => {
	it("stores comments, nags in order and evals", () => {
		const tree = createGameTree({ kind: "standard" });
		const e4 = tree.addMove(tree.root, "e2e4");
		const info: SearchInfo = {
			searchId: 1,
			depth: 12,
			multipv: 1,
			score: { kind: "cp", value: 30 },
			pv: ["e7e5"],
		};
		tree.setComment(e4, "Best by test");
		tree.setNags(e4, [1, 14]);
		tree.setEval(e4, info);
		expect(tree.node(e4)).toMatchObject({ comment: "Best by test", nags: [1, 14], eval: info });
		tree.setComment(e4, null);
		expect(tree.node(e4).comment).toBeNull();
	});
});
