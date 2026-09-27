import type { BestMove, EngineNotice, Score, ScoreBound, SearchId, SearchInfo } from "./types";

const NULL_MOVES: ReadonlySet<string> = new Set(["0000", "(none)"]);

const INTEGER = /^-?\d+$/;

const HASH_ALLOCATION_FAILED =
	/^info string Hash: failed to allocate (\d+) MB, still using (\d+) MB$/;

const ENGINE_ERROR = /^info string error: (.*)$/;

function tokenize(line: string): string[] {
	return line
		.trim()
		.split(/\s+/)
		.filter((token) => token.length > 0);
}

function integerAt(tokens: readonly string[], index: number): number | undefined {
	const token = tokens[index];
	return token !== undefined && INTEGER.test(token) ? Number(token) : undefined;
}

function boundAt(tokens: readonly string[], index: number): ScoreBound | undefined {
	switch (tokens[index]) {
		case "lowerbound":
			return "lower";
		case "upperbound":
			return "upper";
		default:
			return undefined;
	}
}

function scoreAt(tokens: readonly string[], index: number): Score | undefined {
	const kind = tokens[index];
	const value = integerAt(tokens, index + 1);
	if ((kind !== "cp" && kind !== "mate") || value === undefined) return undefined;
	const bound = boundAt(tokens, index + 2);
	return bound === undefined ? { kind, value } : { kind, value, bound };
}

type IntegerField = "depth" | "seldepth" | "multipv" | "nodes" | "nps" | "timeMs";

type InfoFields = { [field in IntegerField]?: number } & { score?: Score; pv?: string[] };

const INTEGER_FIELDS: Readonly<Record<string, IntegerField>> = {
	depth: "depth",
	seldepth: "seldepth",
	multipv: "multipv",
	nodes: "nodes",
	nps: "nps",
	time: "timeMs",
};

function collectInfoFields(tokens: readonly string[]): InfoFields {
	const fields: InfoFields = {};
	for (let index = 1; index < tokens.length; index++) {
		const token = tokens[index];
		if (token === undefined) break;
		if (token === "pv") {
			fields.pv = tokens.slice(index + 1);
			break;
		}
		if (token === "score") {
			const score = scoreAt(tokens, index + 1);
			if (score !== undefined) fields.score = score;
			continue;
		}
		const field = INTEGER_FIELDS[token];
		const value = integerAt(tokens, index + 1);
		if (field !== undefined && value !== undefined) fields[field] = value;
	}
	return fields;
}

export function parseInfoLine(line: string, searchId: SearchId): SearchInfo | undefined {
	const tokens = tokenize(line);
	if (tokens[0] !== "info" || tokens.includes("string")) return undefined;
	const fields = collectInfoFields(tokens);
	if (fields.depth === undefined || fields.score === undefined) return undefined;
	return {
		searchId,
		depth: fields.depth,
		...(fields.seldepth !== undefined && { seldepth: fields.seldepth }),
		multipv: fields.multipv ?? 1,
		score: fields.score,
		...(fields.nodes !== undefined && { nodes: fields.nodes }),
		...(fields.nps !== undefined && { nps: fields.nps }),
		...(fields.timeMs !== undefined && { timeMs: fields.timeMs }),
		pv: fields.pv ?? [],
	};
}

function moveOrNull(token: string): string | null {
	return NULL_MOVES.has(token) ? null : token;
}

export function parseBestMove(line: string, searchId: SearchId): BestMove | undefined {
	const tokens = tokenize(line);
	const move = tokens[1];
	if (tokens[0] !== "bestmove" || move === undefined) return undefined;
	const ponder = tokens[2] === "ponder" && tokens[3] !== undefined ? moveOrNull(tokens[3]) : null;
	return ponder === null
		? { searchId, move: moveOrNull(move) }
		: { searchId, move: moveOrNull(move), ponder };
}

export function parseEngineNotice(line: string): EngineNotice | undefined {
	const hash = HASH_ALLOCATION_FAILED.exec(line);
	if (hash)
		return {
			kind: "hash-allocation-failed",
			requestedMb: Number(hash[1]),
			effectiveMb: Number(hash[2]),
		};
	const error = ENGINE_ERROR.exec(line);
	if (error) return { kind: "engine-error", message: error[1] ?? "" };
	return undefined;
}
