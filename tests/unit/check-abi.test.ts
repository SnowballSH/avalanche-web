import { describe, expect, it } from "vitest";
import type { ModuleAbi } from "../../src/lib/pins/abi-check";
import { compareAbi, describeModuleAbi, formatAbiDifference } from "../../src/lib/pins/abi-check";
import recorded from "../../vendor/avalanche-web-abi1/abi.json";
import { synthesizeWasm } from "./helpers/wasm-module";

const recordedImports = recorded.imports.map((entry) => `${entry.module}.${entry.name}`);
const recordedExports = recorded.exports
	.filter((entry) => entry.kind === "function")
	.map((entry) => entry.name);

function abiOf(bytes: Uint8Array<ArrayBuffer>): ModuleAbi {
	return describeModuleAbi(new WebAssembly.Module(bytes));
}

describe("describeModuleAbi", () => {
	it("lists imports and exports with their kinds, sorted by name", () => {
		const abi = abiOf(synthesizeWasm({ imports: ["env.b", "env.a"], exports: ["z", "y"] }));
		expect(abi).toEqual({
			imports: [
				{ module: "env", name: "a", kind: "function" },
				{ module: "env", name: "b", kind: "function" },
			],
			exports: [
				{ name: "memory", kind: "memory" },
				{ name: "y", kind: "function" },
				{ name: "z", kind: "function" },
			],
		});
	});
});

describe("compareAbi", () => {
	const matching = abiOf(synthesizeWasm({ imports: recordedImports, exports: recordedExports }));

	it("reports no differences for a module matching the recorded ABI", () => {
		expect(compareAbi(recorded, matching)).toEqual([]);
	});

	it("reports the recorded abi.json as matching itself", () => {
		expect(compareAbi(recorded, recorded)).toEqual([]);
	});

	it("fails a module with a renamed export", () => {
		const renamed = abiOf(
			synthesizeWasm({
				imports: recordedImports,
				exports: recordedExports.map((name) =>
					name === "avalanche_command" ? "avalanche_cmd" : name,
				),
			}),
		);
		expect(compareAbi(recorded, renamed)).toEqual([
			{ side: "export", change: "missing", name: "avalanche_command", kind: "function" },
			{ side: "export", change: "unexpected", name: "avalanche_cmd", kind: "function" },
		]);
	});

	it("fails a module with a removed export", () => {
		const removed = abiOf(
			synthesizeWasm({
				imports: recordedImports,
				exports: recordedExports.filter((name) => name !== "avalanche_bench"),
			}),
		);
		expect(compareAbi(recorded, removed)).toEqual([
			{ side: "export", change: "missing", name: "avalanche_bench", kind: "function" },
		]);
	});

	it("fails a module with a renamed import", () => {
		const renamed = abiOf(
			synthesizeWasm({
				imports: recordedImports.map((name) =>
					name === "env.avalanche_write" ? "env.avalanche_print" : name,
				),
				exports: recordedExports,
			}),
		);
		expect(compareAbi(recorded, renamed)).toEqual([
			{ side: "import", change: "missing", name: "env.avalanche_write", kind: "function" },
			{ side: "import", change: "unexpected", name: "env.avalanche_print", kind: "function" },
		]);
	});

	it("fails a module with a removed import", () => {
		const removed = abiOf(
			synthesizeWasm({
				imports: recordedImports.filter((name) => name !== "env.avalanche_now_ms"),
				exports: recordedExports,
			}),
		);
		expect(compareAbi(recorded, removed)).toEqual([
			{ side: "import", change: "missing", name: "env.avalanche_now_ms", kind: "function" },
		]);
	});

	it("fails a module whose memory export is missing", () => {
		const noMemory = abiOf(
			synthesizeWasm({ imports: recordedImports, exports: recordedExports, exportMemory: false }),
		);
		expect(compareAbi(recorded, noMemory)).toEqual([
			{ side: "export", change: "missing", name: "memory", kind: "memory" },
		]);
	});

	it("fails when a name keeps its place but changes kind", () => {
		const kindChanged: ModuleAbi = {
			imports: recorded.imports,
			exports: recorded.exports.map((entry) =>
				entry.name === "memory" ? { name: "memory", kind: "table" } : entry,
			),
		};
		expect(compareAbi(recorded, kindChanged)).toEqual([
			{ side: "export", change: "missing", name: "memory", kind: "memory" },
			{ side: "export", change: "unexpected", name: "memory", kind: "table" },
		]);
	});
});

describe("formatAbiDifference", () => {
	it("prints one readable line per difference", () => {
		expect(
			formatAbiDifference({
				side: "export",
				change: "missing",
				name: "avalanche_bench",
				kind: "function",
			}),
		).toBe("missing export: avalanche_bench (function)");
		expect(
			formatAbiDifference({
				side: "import",
				change: "unexpected",
				name: "env.avalanche_print",
				kind: "function",
			}),
		).toBe("unexpected import: env.avalanche_print (function)");
	});
});
