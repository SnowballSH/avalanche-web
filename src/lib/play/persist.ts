import type { GameResultReason } from "$lib/chess/types";
import type { PlayStore, SavedGame } from "./types";

export const PLAY_STORAGE_KEY = "avalanche-play-v1";

export type PlayStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type Check = (value: unknown) => boolean;

const FRC_MAX = 959;

const RESULT_REASONS: ReadonlySet<GameResultReason> = new Set([
	"checkmate",
	"stalemate",
	"threefold",
	"fifty-move",
	"insufficient",
	"flag",
	"resign",
	"agreement",
]);

const record = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const shape =
	(fields: Readonly<Record<string, Check>>): Check =>
	(value) =>
		record(value) && Object.entries(fields).every(([name, check]) => check(value[name]));

const oneOf =
	(...checks: readonly Check[]): Check =>
	(value) =>
		checks.some((check) => check(value));

const literal =
	(...values: readonly unknown[]): Check =>
	(value) =>
		values.includes(value);

const arrayOf =
	(check: Check): Check =>
	(value) =>
		Array.isArray(value) && value.every(check);

const optional =
	(check: Check): Check =>
	(value) =>
		value === undefined || check(value);

const isString: Check = (value) => typeof value === "string";

const isBoolean: Check = (value) => typeof value === "boolean";

const isInteger: Check = (value) => Number.isSafeInteger(value);

const isPositiveInteger: Check = (value) => Number.isSafeInteger(value) && (value as number) > 0;

const isNonNegative: Check = (value) =>
	typeof value === "number" && Number.isFinite(value) && value >= 0;

const isColor = literal("white", "black");

const isStart = oneOf(
	shape({ kind: literal("standard") }),
	shape({ kind: literal("fen"), fen: isString }),
	shape({
		kind: literal("frc"),
		scharnagl: (value) =>
			isInteger(value) && (value as number) >= 0 && (value as number) <= FRC_MAX,
	}),
);

const isSettings = shape({
	side: literal("white", "black", "random"),
	start: isStart,
	pinId: isString,
	strength: oneOf(
		shape({ kind: literal("full") }),
		shape({ kind: literal("elo"), elo: isInteger }),
	),
	timeControl: shape({ baseMs: isPositiveInteger, incrementMs: isNonNegative }),
	engineLimit: oneOf(
		literal(null),
		shape({ kind: literal("movetime", "depth", "nodes"), value: isPositiveInteger }),
	),
	hashMb: isPositiveInteger,
	threads: oneOf(literal(null), isPositiveInteger),
	ponder: isBoolean,
});

const isScore = shape({
	kind: literal("cp", "mate"),
	value: isInteger,
	bound: optional(literal("lower", "upper")),
});

const isSavedGame = shape({
	version: literal(1),
	setup: shape({ settings: isSettings, userColor: isColor, startedAt: isString }),
	moves: arrayOf(isString),
	clock: shape({
		whiteMs: isNonNegative,
		blackMs: isNonNegative,
		running: oneOf(literal(null), isColor),
	}),
	engineScores: arrayOf(isScore),
	result: oneOf(
		literal(null),
		shape({
			winner: literal("white", "black", "draw"),
			reason: (value) => RESULT_REASONS.has(value as GameResultReason),
		}),
	),
});

const parse = (text: string): unknown => {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
};

export const createPlayStore = (storage: PlayStorage | undefined): PlayStore => {
	const clear = (): void => {
		try {
			storage?.removeItem(PLAY_STORAGE_KEY);
		} catch {
			return;
		}
	};
	return {
		load() {
			let text: string | null;
			try {
				text = storage?.getItem(PLAY_STORAGE_KEY) ?? null;
			} catch {
				return null;
			}
			if (text === null) return null;
			const value = parse(text);
			if (isSavedGame(value)) return value as SavedGame;
			clear();
			return null;
		},
		save(game) {
			try {
				storage?.setItem(PLAY_STORAGE_KEY, JSON.stringify(game));
			} catch {
				return;
			}
		},
		clear,
	};
};

export const browserPlayStore = (): PlayStore => {
	try {
		return createPlayStore(typeof window === "undefined" ? undefined : window.localStorage);
	} catch {
		return createPlayStore(undefined);
	}
};
