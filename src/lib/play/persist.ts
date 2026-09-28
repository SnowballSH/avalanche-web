import type { GameResultReason } from "$lib/chess/types";
import { replayGame, sideToMove } from "./replay";
import { withinEngineLimit } from "./setup";
import type { EngineLimitKind, PlayStore, SavedGame } from "./types";

export const PLAY_STORAGE_KEY = "avalanche-play-v1";

export type PlayStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface PlayStoreOptions {
	readonly hashChoices?: readonly number[];
}

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

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

const isIsoTimestamp: Check = (value) =>
	typeof value === "string" && ISO_TIMESTAMP.test(value) && Number.isFinite(Date.parse(value));

const isEngineLimit: Check = (value) =>
	shape({ kind: literal("movetime", "depth", "nodes"), value: isPositiveInteger })(value) &&
	withinEngineLimit((value as { kind: EngineLimitKind }).kind, (value as { value: number }).value);

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
	engineLimit: oneOf(literal(null), isEngineLimit),
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
	setup: shape({ settings: isSettings, userColor: isColor, startedAt: isIsoTimestamp }),
	moves: arrayOf(isString),
	clock: shape({
		whiteMs: isNonNegative,
		blackMs: isNonNegative,
		running: oneOf(literal(null), isColor),
	}),
	engineScores: arrayOf(oneOf(literal(null), isScore)),
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

const consistent = (game: SavedGame): boolean => {
	const tree = replayGame(game.setup.settings.start, game.moves);
	if (!tree) return false;
	const { running } = game.clock;
	return game.result === null ? running === null || running === sideToMove(tree) : running === null;
};

const clampHash = (hashMb: number, choices: readonly number[] | undefined): number => {
	if (!choices || choices.length === 0 || choices.includes(hashMb)) return hashMb;
	const fitting = choices.filter((choice) => choice <= hashMb);
	return fitting.length > 0 ? Math.max(...fitting) : Math.min(...choices);
};

const withHash = (game: SavedGame, choices: readonly number[] | undefined): SavedGame => {
	const { settings } = game.setup;
	const hashMb = clampHash(settings.hashMb, choices);
	return hashMb === settings.hashMb
		? game
		: { ...game, setup: { ...game.setup, settings: { ...settings, hashMb } } };
};

export const createPlayStore = (
	storage: PlayStorage | undefined,
	options: PlayStoreOptions = {},
): PlayStore => {
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
			if (isSavedGame(value) && consistent(value as SavedGame)) {
				return withHash(value as SavedGame, options.hashChoices);
			}
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

export const browserPlayStore = (options: PlayStoreOptions = {}): PlayStore => {
	try {
		return createPlayStore(
			typeof window === "undefined" ? undefined : window.localStorage,
			options,
		);
	} catch {
		return createPlayStore(undefined, options);
	}
};
