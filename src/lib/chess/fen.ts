import {
	type Castles,
	Chess,
	COLORS,
	isNormal,
	type Move,
	type Position,
	type Setup,
} from "chessops";
import { castlingSide, normalizeMove } from "chessops/chess";
import { makeFen, parseFen as parseSetup } from "chessops/fen";
import { kingCastlesTo, makeUci, squareFile } from "chessops/util";
import type { Fen, UciMove } from "$lib/engine/types";
import type { ImportError, ImportResult, ParsedFen } from "./types";

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

const MAX_UTF8_BYTES_PER_UTF16_UNIT = 3;

const utf8Length = (text: string): number => {
	if (text.length * MAX_UTF8_BYTES_PER_UTF16_UNIT <= MAX_IMPORT_BYTES) return text.length;
	if (text.length > MAX_IMPORT_BYTES) return text.length;
	return new TextEncoder().encode(text).byteLength;
};

export const importSizeError = (text: string): ImportError | undefined =>
	utf8Length(text) > MAX_IMPORT_BYTES
		? {
				kind: "too-large",
				message: `The input is larger than the 5 MB import limit`,
			}
		: undefined;

const invalidFen = (message: string): ImportResult<never> => ({
	ok: false,
	error: { kind: "invalid-fen", message },
});

const describeSetupError = (code: string): string => {
	switch (code) {
		case "ERR_EMPTY":
			return "the board is empty";
		case "ERR_OPPOSITE_CHECK":
			return "the side not to move is in check";
		case "ERR_PAWNS_ON_BACKRANK":
			return "a pawn stands on the first or last rank";
		case "ERR_KINGS":
			return "each side needs exactly one king";
		default:
			return code;
	}
};

const describeFenError = (code: string): string => {
	switch (code) {
		case "ERR_FEN":
			return "the field layout is wrong";
		case "ERR_BOARD":
			return "the board field is malformed";
		case "ERR_TURN":
			return "the side to move must be w or b";
		case "ERR_CASTLING":
			return "the castling field is malformed";
		case "ERR_EP_SQUARE":
			return "the en passant field is malformed";
		case "ERR_HALFMOVES":
			return "the halfmove clock is malformed";
		case "ERR_FULLMOVES":
			return "the move number is malformed";
		default:
			return code;
	}
};

const KING_FILE = 4;
const STANDARD_ROOK_FILES = { a: 0, h: 7 } as const;

const hasStandardCastlingGeometry = (position: Position): boolean =>
	COLORS.every((color) => {
		const king = position.board.kingOf(color);
		const rooks: Castles["rook"][typeof color] = position.castles.rook[color];
		for (const side of ["a", "h"] as const) {
			const rook = rooks[side];
			if (rook === undefined) continue;
			if (king === undefined || squareFile(king) !== KING_FILE) return false;
			if (squareFile(rook) !== STANDARD_ROOK_FILES[side]) return false;
		}
		return true;
	});

export interface ParseFenOptions {
	readonly chess960?: boolean;
}

export const parseFenSetup = (text: string): ImportResult<Setup> => {
	const oversized = importSizeError(text);
	if (oversized) return { ok: false, error: oversized };
	const trimmed = text.trim();
	if (trimmed.length === 0) return invalidFen("The FEN is empty");
	const setup = parseSetup(trimmed);
	if (setup.isErr) return invalidFen(`Invalid FEN: ${describeFenError(setup.error.message)}`);
	return { ok: true, value: setup.value };
};

export const parseFen = (text: string, options?: ParseFenOptions): ImportResult<ParsedFen> => {
	const setup = parseFenSetup(text);
	if (!setup.ok) return setup;
	const position = Chess.fromSetup(setup.value);
	if (position.isErr) {
		return invalidFen(`Illegal position: ${describeSetupError(position.error.message)}`);
	}
	if (!options?.chess960 && !hasStandardCastlingGeometry(position.value)) {
		return {
			ok: false,
			error: {
				kind: "unsupported-variant",
				message:
					"This position's castling rights need Chess960 rules: start it as an FRC game, or remove the castling rights",
			},
		};
	}
	return { ok: true, value: { fen: makeFen(position.value.toSetup()) } };
};

export const positionFromFen = (fen: Fen): Position =>
	parseSetup(fen)
		.chain((setup) => Chess.fromSetup(setup))
		.unwrap();

export const epdOf = (fen: Fen): string => fen.split(" ").slice(0, 4).join(" ");

export const moveToUci = (position: Position, move: Move, chess960: boolean): UciMove => {
	const side = isNormal(move) ? castlingSide(position, move) : undefined;
	if (!isNormal(move) || side === undefined) return makeUci(move);
	if (chess960) return makeUci(normalizeMove(position, move));
	return makeUci({ from: move.from, to: kingCastlesTo(position.turn, side) });
};
