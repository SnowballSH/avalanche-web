import { describe, expect, it } from "vitest";
import { exportPgn, importPgn, MAX_IMPORT_BYTES } from "../../src/lib/chess/pgn";
import { createGameTree } from "../../src/lib/chess/tree";
import type { GameTree, ImportedGame, ImportResult } from "../../src/lib/chess/types";
import type { SearchInfo } from "../../src/lib/engine/types";

const unwrap = <T>(result: ImportResult<T>): T => {
	if (!result.ok) throw new Error(`unexpected import error: ${result.error.message}`);
	return result.value;
};

const failure = <T>(result: ImportResult<T>) => {
	if (result.ok) throw new Error("expected an import error");
	return result.error;
};

const gameAt = (text: string, index: number): ImportedGame => {
	const games = unwrap(importPgn(text));
	return games[index] as ImportedGame;
};

const onlyGame = (text: string): { headers: ReadonlyMap<string, string>; tree: GameTree } => {
	const games = unwrap(importPgn(text));
	expect(games).toHaveLength(1);
	const game = games[0] as ImportedGame;
	return { headers: game.headers, tree: unwrap(game.tree()) };
};

const gameError = (text: string, index = 0) => failure(gameAt(text, index).tree());

const mainlineSans = (tree: GameTree): (string | null)[] =>
	tree
		.mainline()
		.slice(1)
		.map((id) => tree.sanAt(id));

const info = (score: SearchInfo["score"], depth = 20): SearchInfo => ({
	searchId: 0,
	depth,
	multipv: 1,
	score,
	pv: [],
});

describe("importPgn", () => {
	it("imports a mainline with a result header", () => {
		const { headers, tree } = onlyGame('[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0');
		expect(headers.get("Result")).toBe("1-0");
		expect(tree.start).toEqual({ kind: "standard" });
		expect(mainlineSans(tree)).toEqual(["e4", "e5", "Nf3", "Nc6", "Bb5", "a6"]);
	});

	it("imports variations, comments, nags and eval comments", () => {
		const { tree } = onlyGame(
			"1. e4 { [%eval 0.3,20] } e5 (1... c5 $1 { Sicilian [%eval -0.25,18] } 2. Nf3) 2. Nf3 $2 $14 { A comment } *",
		);
		const [e4, e5, nf3] = tree.mainline().slice(1) as [number, number, number];
		expect(tree.node(e4).eval).toEqual(info({ kind: "cp", value: -30 }));
		expect(tree.node(e4).comment).toBeNull();
		expect(tree.children(e4)).toHaveLength(2);
		const c5 = tree.children(e4)[1] as number;
		expect(tree.sanAt(c5)).toBe("c5");
		expect(tree.node(c5).nags).toEqual([1]);
		expect(tree.node(c5).comment).toBe("Sicilian");
		expect(tree.node(c5).eval).toEqual(info({ kind: "cp", value: -25 }, 18));
		expect(tree.sanAt(tree.children(c5)[0] as number)).toBe("Nf3");
		expect(tree.node(nf3).nags).toEqual([2, 14]);
		expect(tree.node(nf3).comment).toBe("A comment");
		expect(tree.node(e5).eval).toBeNull();
	});

	it("reads a mate eval from White's point of view into the side to move's score", () => {
		const { tree } = onlyGame("1. e4 { [%eval #3] } e5 { [%eval #-2,9] } *");
		const [e4, e5] = tree.mainline().slice(1) as [number, number];
		expect(tree.node(e4).eval?.score).toEqual({ kind: "mate", value: -3 });
		expect(tree.node(e5).eval?.score).toEqual({ kind: "mate", value: -2 });
		expect(tree.node(e5).eval?.depth).toBe(9);
	});

	it("keeps a comment before the first move on the root", () => {
		const { tree } = onlyGame("{ Opening thoughts } 1. d4 *");
		expect(tree.node(tree.root).comment).toBe("Opening thoughts");
	});

	it("imports a multi-game PGN in order", () => {
		const games = unwrap(
			importPgn('[White "A"]\n\n1. e4 *\n\n[White "B"]\n\n1. d4 d5 *\n\n[White "C"]\n\n*'),
		);
		expect(games.map((game) => game.headers.get("White"))).toEqual(["A", "B", "C"]);
		expect(games.map((game) => mainlineSans(unwrap(game.tree())).length)).toEqual([1, 2, 0]);
	});

	it("imports a FEN start with the SetUp tag", () => {
		const fen = "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1";
		const { tree } = onlyGame(`[SetUp "1"]\n[FEN "${fen}"]\n\n1. e4 Kd7 *`);
		expect(tree.start).toEqual({ kind: "fen", fen });
		expect(mainlineSans(tree)).toEqual(["e4", "Kd7"]);
	});

	it("rejects an untagged FEN start that needs Chess960 castling, and accepts it without rights", () => {
		const rights = '[FEN "bbqnnrkr/pppppppp/8/8/8/8/PPPPPPPP/BBQNNRKR w KQkq - 0 1"]\n\n1. g3 *';
		const error = gameError(rights);
		expect(error).toMatchObject({ kind: "unsupported-variant", game: 0 });
		expect(error.message).toMatch(/Chess960|FRC/);
		const none = '[FEN "bbqnnrkr/pppppppp/8/8/8/8/PPPPPPPP/BBQNNRKR w - - 0 1"]\n\n1. g3 *';
		expect(onlyGame(none).tree.start).toEqual({
			kind: "fen",
			fen: "bbqnnrkr/pppppppp/8/8/8/8/PPPPPPPP/BBQNNRKR w - - 0 1",
		});
	});

	it("imports a Chess960 game as an FRC start with its Scharnagl number", () => {
		const { tree } = onlyGame(
			'[Variant "Chess960"]\n[SetUp "1"]\n[FEN "bbqnnrkr/pppppppp/8/8/8/8/PPPPPPPP/BBQNNRKR w KQkq - 0 1"]\n\n1. g3 g6 2. f3 f6 3. Rf2 Rf7 4. O-O *',
		);
		expect(tree.start).toEqual({ kind: "frc", scharnagl: 0 });
		const last = tree.mainline().at(-1) as number;
		expect(tree.node(last).move).toBe("g1h1");
		expect(tree.sanAt(last)).toBe("O-O");
	});

	it("treats Chess960 without a FEN as the standard start and accepts spelling variants", () => {
		expect(onlyGame('[Variant "chess 960"]\n\n1. e4 *').tree.start).toEqual({
			kind: "frc",
			scharnagl: 518,
		});
		expect(onlyGame('[Variant "Fischerandom"]\n\n*').tree.start).toEqual({
			kind: "frc",
			scharnagl: 518,
		});
	});

	it("rejects a Chess960 game that does not start from a Scharnagl position", () => {
		const error = gameError(
			'[Variant "Chess960"]\n[FEN "bbqnnrkr/pppppppp/8/8/8/8/PPPPPPPP/BBQNNRKR w - - 0 1"]\n\n*',
		);
		expect(error.kind).toBe("unsupported-variant");
		expect(error.game).toBe(0);
	});

	it("rejects other variants", () => {
		const error = gameError('[Variant "Crazyhouse"]\n\n1. e4 *');
		expect(error).toMatchObject({ kind: "unsupported-variant", game: 0 });
		expect(error.message).toContain("Crazyhouse");
	});

	describe("hostile input (Review Focus 4)", () => {
		it("rejects an illegal FEN header with a typed error", () => {
			const error = gameError('[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP w KQkq - 0 1"]\n\n*');
			expect(error).toMatchObject({ kind: "invalid-fen", game: 0 });
		});

		it("rejects a FEN header that parses but is not a legal position", () => {
			const error = gameError('[FEN "8/8/8/8/8/8/8/8 w - - 0 1"]\n\n*');
			expect(error.kind).toBe("invalid-fen");
		});

		it("rejects an illegal move mid-game naming the game, ply and san", () => {
			const error = gameError("1. e4 e5 2. Nf3 Nc6 3. Bb5 Kd7 4. O-O *");
			expect(error).toMatchObject({ kind: "illegal-move", game: 0, ply: 6, san: "Kd7" });
			expect(error.message).toContain("Kd7");
		});

		it("keeps a broken second game from blocking the first", () => {
			const games = unwrap(importPgn("1. e4 *\n\n1. e4 e5 2. Ke3 Ke6 *"));
			expect(games).toHaveLength(2);
			expect(mainlineSans(unwrap((games[0] as ImportedGame).tree()))).toEqual(["e4"]);
			const error = failure((games[1] as ImportedGame).tree());
			expect(error).toMatchObject({ kind: "illegal-move", game: 1, ply: 3, san: "Ke3" });
			expect((games[1] as ImportedGame).tree()).toBe((games[1] as ImportedGame).tree());
		});

		it("rejects an illegal move inside a variation", () => {
			const error = gameError("1. e4 (1. e5) e5 *");
			expect(error).toMatchObject({ kind: "illegal-move", ply: 1, san: "e5" });
		});

		it("rejects garbage and empty text with no-games", () => {
			expect(failure(importPgn("")).kind).toBe("no-games");
			expect(failure(importPgn("   \n\n  ")).kind).toBe("no-games");
			expect(failure(importPgn("lorem ipsum ]]] ((( \u0000�")).kind).toBe("no-games");
			expect(failure(importPgn("��� binary �")).kind).toBe("no-games");
		});

		it("rejects input over 5 MB before parsing", () => {
			const huge = `1. e4 e5 ${"2. Nf3 Nc6 ".repeat(MAX_IMPORT_BYTES / 10)}*`;
			expect(huge.length).toBeGreaterThan(MAX_IMPORT_BYTES);
			const started = performance.now();
			const error = failure(importPgn(huge));
			expect(performance.now() - started).toBeLessThan(1000);
			expect(error.kind).toBe("too-large");
			expect(error.message).toContain("5 MB");
		});

		it("measures the cap in UTF-8 bytes", () => {
			const text = "\u{1F600}".repeat(MAX_IMPORT_BYTES / 4 + 1);
			expect(text.length).toBeLessThanOrEqual(MAX_IMPORT_BYTES);
			expect(failure(importPgn(text)).kind).toBe("too-large");
		});

		it("rejects a game whose nesting exceeds the parser budget", () => {
			const deep = `1. e4 ${"(1. d4 ".repeat(400_000)}*`;
			expect(deep.length).toBeLessThan(MAX_IMPORT_BYTES);
			const error = failure(importPgn(deep));
			expect(error).toMatchObject({ kind: "malformed", game: 0 });
		});

		it("never throws on arbitrary strings", () => {
			const samples = [
				"[",
				'[Event "',
				"1.",
				"1. e4 e5 2.",
				"( ( ( ) ) )",
				"1. e4 {unterminated",
				"$",
				"1. e4 $999999999999",
				"1. e4 1-0 1. d4 0-1",
				"\u0000".repeat(100),
			];
			for (const sample of samples) {
				expect(() => {
					const result = importPgn(sample);
					if (result.ok) for (const game of result.value) game.tree();
				}).not.toThrow();
			}
		});
	});
});

describe("exportPgn", () => {
	it("writes the seven tag roster with the mainline and a result of *", () => {
		const tree = createGameTree({ kind: "standard" });
		const e4 = tree.addMove(tree.root, "e2e4");
		tree.addMove(e4, "e7e5");
		expect(exportPgn(tree, { evals: false })).toBe(
			'[Event "?"]\n[Site "?"]\n[Date "????.??.??"]\n[Round "?"]\n[White "?"]\n[Black "?"]\n[Result "*"]\n\n1. e4 e5 *\n',
		);
	});

	it("writes variations, comments, nags and evals from White's point of view", () => {
		const tree = createGameTree({ kind: "standard" });
		const e4 = tree.addMove(tree.root, "e2e4");
		const e5 = tree.addMove(e4, "e7e5");
		const c5 = tree.addMove(e4, "c7c5");
		tree.setEval(e4, info({ kind: "cp", value: -30 }, 20));
		tree.setEval(e5, info({ kind: "cp", value: 25 }, 18));
		tree.setEval(c5, info({ kind: "mate", value: 4 }, 30));
		tree.setNags(e5, [1, 14]);
		tree.setComment(c5, "Sicilian");
		tree.setComment(tree.root, "Root");
		const text = exportPgn(tree, { evals: true });
		expect(text.split("\n\n")[1]).toBe(
			"{ Root } 1. e4 { [%eval 0.30,20] } e5 $1 $14 { [%eval 0.25,18] } ( 1... c5 { Sicilian [%eval #4,30] } ) *\n",
		);
		expect(exportPgn(tree, { evals: false }).split("\n\n")[1]).toBe(
			"{ Root } 1. e4 e5 $1 $14 ( 1... c5 { Sicilian } ) *\n",
		);
	});

	it("writes promotion and disambiguated SAN produced by addMove", () => {
		const promotion = createGameTree({ kind: "fen", fen: "8/1P4k1/8/8/8/8/8/K7 w - - 0 1" });
		promotion.addMove(promotion.root, "b7b8q");
		expect(exportPgn(promotion, { evals: false })).toContain("\n\n1. b8=Q *\n");

		const knights = createGameTree({ kind: "fen", fen: "4k3/8/8/8/8/8/N3N3/4K3 w - - 0 1" });
		knights.addMove(knights.root, "a2c3");
		expect(exportPgn(knights, { evals: false })).toContain("\n\n1. Nac3 *\n");

		const rooks = createGameTree({ kind: "fen", fen: "k7/8/8/4R3/8/8/8/4RK2 w - - 0 1" });
		rooks.addMove(rooks.root, "e1e2");
		expect(exportPgn(rooks, { evals: false })).toContain("\n\n1. R1e2 *\n");
	});

	it("writes SetUp and FEN for a FEN start and numbers the moves from it", () => {
		const fen = "4k3/8/8/8/8/8/4P3/4K3 b - - 3 12";
		const tree = createGameTree({ kind: "fen", fen });
		tree.addMove(tree.root, "e8d7");
		const text = exportPgn(tree, { evals: false });
		expect(text).toContain('[SetUp "1"]\n');
		expect(text).toContain(`[FEN "${fen}"]\n`);
		expect(text.endsWith("\n\n12... Kd7 *\n")).toBe(true);
	});

	it("writes the Chess960 variant and FEN for an FRC start, even for 518", () => {
		const frc = createGameTree({ kind: "frc", scharnagl: 0 });
		expect(exportPgn(frc, { evals: false })).toContain(
			'[Variant "Chess960"]\n[SetUp "1"]\n[FEN "bbqnnrkr/pppppppp/8/8/8/8/PPPPPPPP/BBQNNRKR w KQkq - 0 1"]\n',
		);
		const standard = createGameTree({ kind: "frc", scharnagl: 518 });
		expect(exportPgn(standard, { evals: false })).toContain('[Variant "Chess960"]\n');
		expect(exportPgn(standard, { evals: false })).toContain(
			'[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"]\n',
		);
	});

	it("takes caller headers, keeps the roster order and derives the position tags itself", () => {
		const tree = createGameTree({ kind: "frc", scharnagl: 1 });
		const headers = new Map([
			["FEN", "bogus"],
			["Variant", "Standard"],
			["Result", "0-1"],
			["Annotator", "Avalanche"],
			["White", "Me"],
		]);
		const text = exportPgn(tree, { evals: false, headers });
		expect(text).toBe(
			'[Event "?"]\n[Site "?"]\n[Date "????.??.??"]\n[Round "?"]\n[White "Me"]\n[Black "?"]\n[Result "0-1"]\n[Annotator "Avalanche"]\n[Variant "Chess960"]\n[SetUp "1"]\n[FEN "bqnbnrkr/pppppppp/8/8/8/8/PPPPPPPP/BQNBNRKR w KQkq - 0 1"]\n\n0-1\n',
		);
	});

	it("round-trips a PGN with variations, comments, nags, evals and FRC tags", () => {
		const source =
			'[Event "Test"]\n[Site "?"]\n[Date "2026.09.27"]\n[Round "1"]\n[White "Avalanche"]\n[Black "Human"]\n[Result "1/2-1/2"]\n[Variant "Chess960"]\n[SetUp "1"]\n[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"]\n\n{ Start } 1. e4 { [%eval 0.30,20] } e5 $1 { Classical [%eval 0.20,19] } ( 1... c5 $5 2. Nf3 { [%eval #5,25] } ) ( 1... e6 { French } ) 2. Nf3 $14 ( 2. f4 { Gambit } ) 2... Nc6 1/2-1/2\n';
		const { headers, tree } = onlyGame(source);
		expect(tree.start).toEqual({ kind: "frc", scharnagl: 518 });
		expect(exportPgn(tree, { evals: true, headers })).toBe(source);
		const again = onlyGame(exportPgn(tree, { evals: true, headers }));
		expect(again.headers).toEqual(headers);
		expect(exportPgn(again.tree, { evals: true, headers: again.headers })).toBe(source);
	});
});
