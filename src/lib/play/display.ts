import type { GameResult, GameTree, San } from "$lib/chess/types";

export interface MoveRow {
	readonly number: number;
	readonly white: San | null;
	readonly black: San | null;
}

const REASONS: Readonly<Record<GameResult["reason"], string>> = {
	checkmate: "checkmate",
	stalemate: "stalemate",
	threefold: "threefold repetition",
	"fifty-move": "the fifty-move rule",
	insufficient: "insufficient material",
	flag: "time",
	resign: "resignation",
	agreement: "agreement",
};

export const resultText = (result: GameResult): string => {
	const reason = REASONS[result.reason];
	if (result.winner === "draw") return `Draw by ${reason}`;
	const winner = result.winner === "white" ? "White" : "Black";
	return result.reason === "flag" ? `${winner} wins on time` : `${winner} wins by ${reason}`;
};

const TENTHS_BELOW_MS = 10_000;

export const formatClock = (ms: number): string => {
	const clamped = Math.max(0, ms);
	if (clamped < TENTHS_BELOW_MS) {
		const tenths = Math.floor(clamped / 100);
		return `0:0${Math.floor(tenths / 10)}.${tenths % 10}`;
	}
	const totalSeconds = Math.floor(clamped / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = String(totalSeconds % 60).padStart(2, "0");
	return hours > 0
		? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
		: `${minutes}:${seconds}`;
};

export const moveRows = (tree: GameTree): MoveRow[] => {
	const rows: MoveRow[] = [];
	for (const id of tree.mainline().slice(1)) {
		const node = tree.node(id);
		const parentFen = tree.fenAt(node.parent ?? tree.root);
		const [, turn, , , , fullmove] = parentFen.split(" ");
		const number = Number(fullmove);
		const last = rows.at(-1);
		if (turn === "w") rows.push({ number, white: node.san, black: null });
		else if (last && last.number === number && last.black === null) {
			rows[rows.length - 1] = { ...last, black: node.san };
		} else rows.push({ number, white: null, black: node.san });
	}
	return rows;
};
