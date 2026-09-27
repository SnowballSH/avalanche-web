import { describe, expect, it } from "vitest";
import { deriveCapabilities, parseOptionLine } from "../../src/lib/engine/capabilities";
import type { UciOptionSpec } from "../../src/lib/engine/types";

const wasmOptionLines = [
	"option name Hash type spin default 16 min 1 max 1048576",
	"option name Threads type spin default 1 min 1 max 1",
	"option name Move Overhead type spin default 25 min 0 max 5000",
	"option name MultiPV type spin default 1 min 1 max 256",
	"option name Ponder type check default false",
	"option name Clear Hash type button",
	"option name UCI_Chess960 type check default false",
	"option name UCI_LimitStrength type check default false",
	"option name UCI_Elo type spin default 3000 min 1320 max 3000",
	"option name Skill Level type spin default 20 min 0 max 20",
	"option name UCI_ShowWDL type check default false",
	"option name Contempt type spin default 0 min -100 max 100",
];

function optionsFrom(lines: readonly string[]): Map<string, UciOptionSpec> {
	const options = new Map<string, UciOptionSpec>();
	for (const line of lines) {
		const option = parseOptionLine(line);
		if (option) options.set(option.name, option.spec);
	}
	return options;
}

describe("parseOptionLine", () => {
	it("parses a spin option", () => {
		expect(parseOptionLine("option name Hash type spin default 16 min 1 max 1048576")).toEqual({
			name: "Hash",
			spec: { kind: "spin", default: 16, min: 1, max: 1048576 },
		});
	});

	it("parses a spin option with a negative minimum", () => {
		expect(parseOptionLine("option name Contempt type spin default 0 min -100 max 100")).toEqual({
			name: "Contempt",
			spec: { kind: "spin", default: 0, min: -100, max: 100 },
		});
	});

	it("parses a check option", () => {
		expect(parseOptionLine("option name Ponder type check default false")).toEqual({
			name: "Ponder",
			spec: { kind: "check", default: false },
		});
		expect(parseOptionLine("option name Syzygy50MoveRule type check default true")).toEqual({
			name: "Syzygy50MoveRule",
			spec: { kind: "check", default: true },
		});
	});

	it("parses a combo option with its values", () => {
		expect(
			parseOptionLine(
				"option name NumaPolicy type combo default auto var auto var none var system",
			),
		).toEqual({
			name: "NumaPolicy",
			spec: { kind: "combo", default: "auto", values: ["auto", "none", "system"] },
		});
	});

	it("parses a button option", () => {
		expect(parseOptionLine("option name Clear Hash type button")).toEqual({
			name: "Clear Hash",
			spec: { kind: "button" },
		});
	});

	it("parses a string option, treating <empty> as the empty string", () => {
		expect(parseOptionLine("option name SyzygyPath type string default <empty>")).toEqual({
			name: "SyzygyPath",
			spec: { kind: "string", default: "" },
		});
		expect(parseOptionLine("option name EvalFile type string default net 12.nnue")).toEqual({
			name: "EvalFile",
			spec: { kind: "string", default: "net 12.nnue" },
		});
	});

	it("keeps spaces inside option names", () => {
		expect(
			parseOptionLine("option name Move Overhead type spin default 25 min 0 max 5000")?.name,
		).toBe("Move Overhead");
		expect(parseOptionLine("option name Skill Level type spin default 20 min 0 max 20")?.name).toBe(
			"Skill Level",
		);
	});

	it("returns undefined for malformed or unrelated lines", () => {
		expect(parseOptionLine("option name Hash type spin default 16 min 1")).toBeUndefined();
		expect(parseOptionLine("option name Hash type spin default x min 1 max 2")).toBeUndefined();
		expect(parseOptionLine("option name Ponder type check")).toBeUndefined();
		expect(parseOptionLine("option name Mystery type slider default 1")).toBeUndefined();
		expect(parseOptionLine("option type spin default 1 min 0 max 2")).toBeUndefined();
		expect(parseOptionLine("id name Avalanche 4.0.0")).toBeUndefined();
		expect(parseOptionLine("uciok")).toBeUndefined();
	});
});

describe("deriveCapabilities", () => {
	it("derives the wasm build's capabilities and hides Threads at max 1", () => {
		const options = optionsFrom(wasmOptionLines);
		const capabilities = deriveCapabilities(options);
		expect(capabilities.options).toBe(options);
		expect(capabilities.threadsMax).toBe(1);
		expect(capabilities.supportsLimitStrength).toBe(true);
		expect(capabilities.eloRange).toEqual({ min: 1320, max: 3000, default: 3000 });
		expect(capabilities.multiPvMax).toBe(256);
		expect(capabilities.supportsChess960).toBe(true);
	});

	it("reports the Threads maximum of a build that advertises more than one", () => {
		const options = optionsFrom([
			...wasmOptionLines.filter((line) => !line.includes("name Threads ")),
			"option name Threads type spin default 1 min 1 max 512",
		]);
		expect(deriveCapabilities(options).threadsMax).toBe(512);
	});

	it("falls back when the strength, MultiPV, Threads and Chess960 options are absent", () => {
		const capabilities = deriveCapabilities(
			optionsFrom(["option name Hash type spin default 16 min 1 max 1024"]),
		);
		expect(capabilities.threadsMax).toBe(1);
		expect(capabilities.supportsLimitStrength).toBe(false);
		expect(capabilities.eloRange).toBeNull();
		expect(capabilities.multiPvMax).toBe(1);
		expect(capabilities.supportsChess960).toBe(false);
	});

	it("ignores an option whose kind is not the expected one", () => {
		const capabilities = deriveCapabilities(
			optionsFrom([
				"option name UCI_Elo type string default 2000",
				"option name Threads type check default true",
			]),
		);
		expect(capabilities.eloRange).toBeNull();
		expect(capabilities.threadsMax).toBe(1);
	});
});
