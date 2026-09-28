import { parseFen } from "$lib/chess/fen";
import type { StartPosition } from "$lib/chess/types";
import { FEN_QUERY_PARAM } from "$lib/editor/editor-state";

export interface LinkedStart {
	readonly start: StartPosition;
	readonly error: string | null;
}

export const startFromLink = (search: string): LinkedStart | null => {
	const text = new URLSearchParams(search).get(FEN_QUERY_PARAM);
	if (text === null) return null;
	const parsed = parseFen(text);
	return parsed.ok
		? { start: { kind: "fen", fen: parsed.value.fen }, error: null }
		: {
				start: { kind: "standard" },
				error: `The linked position is invalid: ${parsed.error.message}`,
			};
};
