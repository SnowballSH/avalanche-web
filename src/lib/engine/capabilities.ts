import type { EloRange, EngineCapabilities, UciOptionSpec } from "./types";

export interface UciOption {
	readonly name: string;
	readonly spec: UciOptionSpec;
}

const EMPTY_STRING_MARKER = "<empty>";

const INTEGER = /^-?\d+$/;

function integer(token: string | undefined): number | undefined {
	return token !== undefined && INTEGER.test(token) ? Number(token) : undefined;
}

function boolean(token: string | undefined): boolean | undefined {
	if (token === "true") return true;
	if (token === "false") return false;
	return undefined;
}

function valueAfter(tokens: readonly string[], keyword: string): string | undefined {
	const index = tokens.indexOf(keyword);
	return index === -1 ? undefined : tokens[index + 1];
}

function spinSpec(tokens: readonly string[]): UciOptionSpec | undefined {
	const defaultValue = integer(valueAfter(tokens, "default"));
	const min = integer(valueAfter(tokens, "min"));
	const max = integer(valueAfter(tokens, "max"));
	if (defaultValue === undefined || min === undefined || max === undefined) return undefined;
	return { kind: "spin", default: defaultValue, min, max };
}

function checkSpec(tokens: readonly string[]): UciOptionSpec | undefined {
	const defaultValue = boolean(valueAfter(tokens, "default"));
	return defaultValue === undefined ? undefined : { kind: "check", default: defaultValue };
}

function comboSpec(tokens: readonly string[]): UciOptionSpec | undefined {
	const groups: string[][] = [];
	for (const token of tokens) {
		if (token === "default" || token === "var") groups.push([]);
		else groups.at(-1)?.push(token);
	}
	const [defaultTokens, ...valueTokens] = groups;
	if (tokens[0] !== "default" || defaultTokens === undefined || defaultTokens.length === 0)
		return undefined;
	return {
		kind: "combo",
		default: defaultTokens.join(" "),
		values: valueTokens.map((group) => group.join(" ")),
	};
}

function stringSpec(rest: string): UciOptionSpec | undefined {
	const match = /^default(?:\s+(.*))?$/s.exec(rest);
	if (!match) return undefined;
	const defaultValue = match[1]?.trim() ?? "";
	return { kind: "string", default: defaultValue === EMPTY_STRING_MARKER ? "" : defaultValue };
}

function specOf(kind: string, rest: string): UciOptionSpec | undefined {
	const tokens = rest.split(/\s+/).filter((token) => token.length > 0);
	switch (kind) {
		case "spin":
			return spinSpec(tokens);
		case "check":
			return checkSpec(tokens);
		case "combo":
			return comboSpec(tokens);
		case "button":
			return { kind: "button" };
		case "string":
			return stringSpec(rest);
		default:
			return undefined;
	}
}

const OPTION_LINE = /^option name (.+?) type (\S+)\s*(.*)$/s;

export function parseOptionLine(line: string): UciOption | undefined {
	const match = OPTION_LINE.exec(line.trim());
	if (!match) return undefined;
	const [, name, kind, rest] = match;
	if (name === undefined || kind === undefined) return undefined;
	const spec = specOf(kind, rest ?? "");
	return spec === undefined ? undefined : { name: name.trim(), spec };
}

function findOption(
	options: ReadonlyMap<string, UciOptionSpec>,
	name: string,
): UciOptionSpec | undefined {
	const wanted = name.toLowerCase();
	for (const [candidate, spec] of options) {
		if (candidate.toLowerCase() === wanted) return spec;
	}
	return undefined;
}

function spinMax(
	options: ReadonlyMap<string, UciOptionSpec>,
	name: string,
	fallback: number,
): number {
	const spec = findOption(options, name);
	return spec?.kind === "spin" ? spec.max : fallback;
}

function hasCheck(options: ReadonlyMap<string, UciOptionSpec>, name: string): boolean {
	return findOption(options, name)?.kind === "check";
}

function eloRange(options: ReadonlyMap<string, UciOptionSpec>): EloRange | null {
	const spec = findOption(options, "UCI_Elo");
	return spec?.kind === "spin" ? { min: spec.min, max: spec.max, default: spec.default } : null;
}

export function deriveCapabilities(
	options: ReadonlyMap<string, UciOptionSpec>,
): EngineCapabilities {
	return {
		options,
		threadsMax: spinMax(options, "Threads", 1),
		supportsLimitStrength: hasCheck(options, "UCI_LimitStrength"),
		eloRange: eloRange(options),
		multiPvMax: spinMax(options, "MultiPV", 1),
		supportsChess960: hasCheck(options, "UCI_Chess960"),
	};
}
