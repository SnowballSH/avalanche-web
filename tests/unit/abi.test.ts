import { describe, expect, it } from "vitest";
import abi from "../../vendor/avalanche-web-abi1/abi.json";
import { assertAvalancheExports } from "../../vendor/avalanche-web-abi1/src/abi.ts";

const importNames = abi.imports.map((entry) => `${entry.module}.${entry.name}`);
const exportNames = abi.exports.map((entry) => entry.name);

describe("recorded ABI", () => {
	it("lists the four env imports the bindings supply", () => {
		expect(importNames).toEqual([
			"env.avalanche_now_ms",
			"env.avalanche_ponderhit_requested",
			"env.avalanche_stop_requested",
			"env.avalanche_write",
		]);
		expect(abi.imports.every((entry) => entry.kind === "function")).toBe(true);
	});

	it("lists every export the vendored bindings require", () => {
		const exports = Object.fromEntries(
			abi.exports.map((entry) => [
				entry.name,
				entry.kind === "memory" ? new WebAssembly.Memory({ initial: 1 }) : () => 0,
			]),
		);
		expect(() => assertAvalancheExports(exports)).not.toThrow();
		expect(exportNames).toContain("memory");
	});

	it("rejects a module missing an export", () => {
		expect(() =>
			assertAvalancheExports({ memory: new WebAssembly.Memory({ initial: 1 }) }),
		).toThrow(/missing exports/);
	});
});
