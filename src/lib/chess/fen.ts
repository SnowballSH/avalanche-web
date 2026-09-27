import { Chess, isNormal, type Move, type Position } from "chessops";
import { castlingSide, normalizeMove } from "chessops/chess";
import { makeFen, parseFen as parseSetup } from "chessops/fen";
import { kingCastlesTo, makeUci } from "chessops/util";
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

export const parseFen = (text: string): ImportResult<ParsedFen> => {
	const oversized = importSizeError(text);
	if (oversized) return { ok: false, error: oversized };
	const trimmed = text.trim();
	if (trimmed.length === 0) return invalidFen("The FEN is empty");
	const setup = parseSetup(trimmed);
	if (setup.isErr) return invalidFen(`Invalid FEN: ${describeFenError(setup.error.message)}`);
	const position = Chess.fromSetup(setup.value);
	if (position.isErr) {
		return invalidFen(`Illegal position: ${describeSetupError(position.error.message)}`);
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
