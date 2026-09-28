import { describe, expect, it } from "vitest";
import { fenFromHash } from "../../src/lib/analysis/hash-link";
import {
	applyTool,
	clearBoard,
	type EditorState,
	type EditorTool,
	editorFen,
	editorFromFen,
	editorLink,
	editorLinks,
	enPassantCandidates,
	FEN_QUERY_PARAM,
	startingEditor,
	validateEditor,
	withCastling,
	withEnPassant,
	withPlacement,
	withTurn,
} from "../../src/lib/editor/editor-state";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const place = (color: "white" | "black", role: "king" | "queen" | "rook" | "pawn"): EditorTool => ({
	kind: "piece",
	piece: { color, role },
});

const loaded = (fen: string): EditorState => {
	const result = editorFromFen(fen);
	if (!result.ok) throw new Error(result.error.message);
	return result.value;
};

const reasonOf = (state: EditorState): string => {
	const validation = validateEditor(state);
	if (validation.ok) throw new Error(`expected an invalid position, got ${validation.fen}`);
	return validation.reason;
};

describe("placing and removing pieces", () => {
	it("starts from the standard position", () => {
		expect(editorFen(startingEditor())).toBe(START_FEN);
	});

	it("places a piece on an empty square and replaces an occupied one", () => {
		const withQueen = applyTool(startingEditor(), "e4", place("white", "queen"));
		expect(withQueen.placement).toBe("rnbqkbnr/pppppppp/8/8/4Q3/8/PPPPPPPP/RNBQKBNR");
		const replaced = applyTool(withQueen, "e4", place("black", "rook"));
		expect(replaced.placement).toBe("rnbqkbnr/pppppppp/8/8/4r3/8/PPPPPPPP/RNBQKBNR");
	});

	it("removes a piece with the eraser, or by placing the same piece again", () => {
		const erased = applyTool(startingEditor(), "d1", { kind: "erase" });
		expect(erased.placement).toBe("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNB1KBNR");
		const toggled = applyTool(startingEditor(), "d8", place("black", "queen"));
		expect(toggled.placement).toBe("rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR");
	});

	it("leaves the board alone with the move tool", () => {
		const state = startingEditor();
		expect(applyTool(state, "e2", { kind: "move" })).toBe(state);
	});

	it("takes the board from a drag, and ignores a malformed one", () => {
		const dragged = withPlacement(
			startingEditor(),
			"rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR",
		);
		expect(dragged.placement).toBe("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR");
		expect(withPlacement(dragged, "not a board")).toBe(dragged);
	});

	it("clears the board together with the castling rights and en passant square", () => {
		const cleared = clearBoard(loaded("4k3/8/8/3pP3/8/8/8/R3K2R w KQ d6 0 3"));
		expect(editorFen(cleared)).toBe("8/8/8/8/8/8/8/8 w - - 0 3");
	});

	it("loads an illegal but well-formed position so it can be fixed", () => {
		const state = loaded("8/8/8/8/8/8/8/8 w - - 0 1");
		expect(reasonOf(state)).toBe("Illegal position: the board is empty");
		const fixed = applyTool(
			applyTool(state, "e1", place("white", "king")),
			"e8",
			place("black", "king"),
		);
		expect(validateEditor(fixed)).toEqual({
			ok: true,
			fen: "4k3/8/8/8/8/8/8/4K3 w - - 0 1",
			normalised: false,
		});
	});

	it("refuses to load a malformed FEN with parseFen's message", () => {
		const result = editorFromFen("rnbqkbnr/pppppppp w KQkq - 0 1");
		expect(result).toEqual({
			ok: false,
			error: { kind: "invalid-fen", message: "Invalid FEN: the board field is malformed" },
		});
	});
});

describe("side to move", () => {
	it("switches the side to move and drops the en passant square", () => {
		const state = loaded("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2");
		const black = withTurn(state, "black");
		expect(editorFen(black)).toBe("4k3/8/8/3pP3/8/8/8/4K3 b - - 0 2");
		expect(withTurn(state, "white")).toBe(state);
	});

	it("rejects a position whose side not to move is in check", () => {
		const state = loaded("4k3/8/8/8/8/8/8/4K2R w - - 0 1");
		const checked = applyTool(state, "e2", place("black", "rook"));
		expect(validateEditor(checked).ok).toBe(true);
		expect(reasonOf(withTurn(checked, "black"))).toBe(
			"Illegal position: the side not to move is in check",
		);
	});
});

describe("castling rights", () => {
	it("keeps the rights whose king and rook stand on their squares", () => {
		const state = loaded("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
		expect(validateEditor(state)).toEqual({
			ok: true,
			fen: "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1",
			normalised: false,
		});
		const withoutWhiteShort = withCastling(state, "K", false);
		expect(editorFen(withoutWhiteShort)).toBe("r3k2r/8/8/8/8/8/8/R3K2R w Qkq - 0 1");
	});

	it("drops a right whose rook is missing and reports the normalised FEN", () => {
		const state = withCastling(loaded("4k3/8/8/8/8/8/8/4K2R w - - 0 1"), "Q", true);
		expect(editorFen(state)).toBe("4k3/8/8/8/8/8/8/4K2R w Q - 0 1");
		expect(validateEditor(state)).toEqual({
			ok: true,
			fen: "4k3/8/8/8/8/8/8/4K2R w - - 0 1",
			normalised: true,
		});
	});

	it("rejects a right that needs Chess960 geometry with parseFen's message", () => {
		const state = withCastling(loaded("4k3/8/8/8/8/8/8/5K1R w - - 0 1"), "K", true);
		expect(reasonOf(state)).toBe(
			"This position's castling rights need Chess960 rules: start it as an FRC game, or remove the castling rights",
		);
	});

	it("reads Shredder-FEN rights back as the standard letters", () => {
		expect(editorFen(loaded("r3k2r/8/8/8/8/8/8/R3K2R w HAha - 0 1"))).toBe(
			"r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1",
		);
	});
});

describe("en passant", () => {
	const afterDoublePush = loaded("4k3/8/8/3pP3/8/8/8/4K3 w - - 0 2");

	it("offers only squares a pawn of the side that just moved could have crossed", () => {
		expect(enPassantCandidates(afterDoublePush)).toEqual(["d6"]);
		expect(enPassantCandidates(withTurn(afterDoublePush, "black"))).toEqual([]);
		const blocked = applyTool(afterDoublePush, "d7", place("black", "rook"));
		expect(enPassantCandidates(blocked)).toEqual([]);
	});

	it("accepts a square from the candidates", () => {
		expect(validateEditor(withEnPassant(afterDoublePush, "d6"))).toEqual({
			ok: true,
			fen: "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2",
			normalised: false,
		});
	});

	it("rejects a square no double pawn push could have produced", () => {
		expect(reasonOf(withEnPassant(afterDoublePush, "e6"))).toBe(
			"The en passant square e6 needs a black pawn that has just advanced two squares past it, with both squares it crossed empty",
		);
	});

	it("rejects the square once the board no longer supports it", () => {
		const state = applyTool(withEnPassant(afterDoublePush, "d6"), "d5", { kind: "erase" });
		expect(reasonOf(state)).toMatch(/^The en passant square d6 needs a black pawn/);
	});

	it("normalises away a square no pawn can capture on", () => {
		const state = withEnPassant(loaded("4k3/8/8/3p4/8/8/8/4K3 w - - 0 2"), "d6");
		expect(validateEditor(state)).toEqual({
			ok: true,
			fen: "4k3/8/8/3p4/8/8/8/4K3 w - - 0 2",
			normalised: true,
		});
	});
});

describe("links out of the editor", () => {
	it("round-trips the FEN through the analysis hash link", () => {
		const fen = "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2";
		const { analysis } = editorLinks(fen);
		expect(analysis).toBe("/analysis#fen=4k3/8/8/3pP3/8/8/8/4K3_w_-_d6_0_2");
		expect(fenFromHash(new URL(analysis, "https://example.test").hash)).toBe(fen);
	});

	it("passes the FEN to the play page as its fen query parameter", () => {
		const { play } = editorLinks(START_FEN);
		const url = new URL(play, "https://example.test");
		expect(url.pathname).toBe("/play");
		expect(FEN_QUERY_PARAM).toBe("fen");
		expect(url.searchParams.get("fen")).toBe(START_FEN);
	});

	it("opens the editor on a FEN through the same query parameter", () => {
		const url = new URL(editorLink(START_FEN), "https://example.test");
		expect(url.pathname).toBe("/editor");
		expect(url.searchParams.get("fen")).toBe(START_FEN);
	});
});
