export type PasteKind = "fen" | "pgn";

const MAX_FEN_LENGTH = 256;

const BOARD_FIELD = /^[^/\s]+(?:\/[^/\s]+){7}$/;

export const pasteKind = (text: string): PasteKind => {
	const trimmed = text.trim();
	if (trimmed.length > MAX_FEN_LENGTH || trimmed.includes("\n")) return "pgn";
	const [board = ""] = trimmed.split(/\s+/, 1);
	return BOARD_FIELD.test(board) ? "fen" : "pgn";
};
