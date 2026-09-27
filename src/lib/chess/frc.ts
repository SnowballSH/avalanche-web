import type { Fen } from "$lib/engine/types";
import { epdOf, parseFen } from "./fen";

export const FRC_POSITIONS = 960;

const LIGHT_BISHOP_FILES = [1, 3, 5, 7] as const;
const DARK_BISHOP_FILES = [0, 2, 4, 6] as const;
const KNIGHT_PAIRS = [
	[0, 1],
	[0, 2],
	[0, 3],
	[0, 4],
	[1, 2],
	[1, 3],
	[1, 4],
	[2, 3],
	[2, 4],
	[3, 4],
] as const;

const assertScharnagl = (n: number): void => {
	if (!Number.isInteger(n) || n < 0 || n >= FRC_POSITIONS) {
		throw new RangeError(`Scharnagl number must be an integer from 0 to 959, got ${n}`);
	}
};

const emptyFiles = (rank: readonly (string | undefined)[]): number[] =>
	rank.flatMap((piece, file) => (piece === undefined ? [file] : []));

export const frcBackRank = (n: number): string => {
	assertScharnagl(n);
	const rank: (string | undefined)[] = Array.from({ length: 8 });
	rank[LIGHT_BISHOP_FILES[n % 4] as number] = "B";
	rank[DARK_BISHOP_FILES[Math.floor(n / 4) % 4] as number] = "B";
	const queenSlot = Math.floor(n / 16) % 6;
	rank[emptyFiles(rank)[queenSlot] as number] = "Q";
	const [first, second] = KNIGHT_PAIRS[Math.floor(n / 96)] as readonly [number, number];
	const knightFiles = emptyFiles(rank);
	rank[knightFiles[first] as number] = "N";
	rank[knightFiles[second] as number] = "N";
	const [queenRook, king, kingRook] = emptyFiles(rank) as [number, number, number];
	rank[queenRook] = "R";
	rank[king] = "K";
	rank[kingRook] = "R";
	return rank.join("");
};

export const frcFen = (n: number): Fen => {
	const backRank = frcBackRank(n);
	return `${backRank.toLowerCase()}/pppppppp/8/8/8/8/PPPPPPPP/${backRank} w KQkq - 0 1`;
};

let numbersByEpd: ReadonlyMap<string, number> | undefined;

const lookupTable = (): ReadonlyMap<string, number> => {
	if (!numbersByEpd) {
		numbersByEpd = new Map(
			Array.from({ length: FRC_POSITIONS }, (_, n) => [epdOf(frcFen(n)), n] as const),
		);
	}
	return numbersByEpd;
};

export const frcNumber = (fen: Fen): number | undefined => {
	const parsed = parseFen(fen, { chess960: true });
	return parsed.ok ? lookupTable().get(epdOf(parsed.value.fen)) : undefined;
};

const UINT16_RANGE = 65536;
const UNBIASED_LIMIT = UINT16_RANGE - (UINT16_RANGE % FRC_POSITIONS);

export const randomFrc = (): number => {
	const sample = new Uint16Array(1);
	do {
		crypto.getRandomValues(sample);
	} while ((sample[0] as number) >= UNBIASED_LIMIT);
	return (sample[0] as number) % FRC_POSITIONS;
};
