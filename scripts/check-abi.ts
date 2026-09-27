#!/usr/bin/env node
/// <reference types="node" />
// Compares a wasm module's imports and exports (names and kinds) with the ABI
// recorded for the site's vendored bindings. Exits 1 and lists every difference
// on a mismatch.
//
//   node scripts/check-abi.ts <path/to/avalanche.wasm> [--abi vendor/avalanche-web-abi1/abi.json]

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
	compareAbi,
	describeModuleAbi,
	formatAbiDifference,
	type ModuleAbi,
} from "../src/lib/pins/abi-check.ts";

const DEFAULT_ABI = fileURLToPath(
	new URL("../vendor/avalanche-web-abi1/abi.json", import.meta.url),
);

interface Arguments {
	readonly wasmPath: string;
	readonly abiPath: string;
}

function usage(): never {
	console.error("usage: check-abi.ts <path/to/avalanche.wasm> [--abi <abi.json>]");
	process.exit(2);
}

function parseArguments(argv: readonly string[]): Arguments {
	let wasmPath: string | undefined;
	let abiPath = DEFAULT_ABI;
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--abi") {
			abiPath = argv[i + 1] ?? usage();
			i += 1;
		} else if (arg?.startsWith("-") || wasmPath !== undefined) {
			usage();
		} else if (arg !== undefined) {
			wasmPath = arg;
		}
	}
	return { wasmPath: wasmPath ?? usage(), abiPath };
}

const { wasmPath, abiPath } = parseArguments(process.argv.slice(2));
const recorded = JSON.parse(await readFile(abiPath, "utf8")) as ModuleAbi;
const actual = describeModuleAbi(new WebAssembly.Module(await readFile(wasmPath)));
const differences = compareAbi(recorded, actual);

if (differences.length === 0) {
	console.log(`check-abi: ${wasmPath} matches ${abiPath}`);
} else {
	console.error(`check-abi: ${wasmPath} does not match ${abiPath}:`);
	for (const difference of differences) console.error(`  ${formatAbiDifference(difference)}`);
	process.exit(1);
}
