#!/usr/bin/env node
// Prints the import and export names and kinds of a wasm module as JSON, sorted,
// in the form WebAssembly.Module.imports/exports report them.
//
//   node scripts/record-abi.mjs path/to/avalanche.wasm > vendor/avalanche-web-abi1/abi.json

import { readFile } from "node:fs/promises";

const [wasmPath] = process.argv.slice(2);
if (!wasmPath) {
	console.error("usage: record-abi.mjs <path/to/avalanche.wasm>");
	process.exit(2);
}

const byName = (a, b) => `${a.module ?? ""}.${a.name}`.localeCompare(`${b.module ?? ""}.${b.name}`);

const module = new WebAssembly.Module(await readFile(wasmPath));
const abi = {
	imports: WebAssembly.Module.imports(module)
		.map(({ module, name, kind }) => ({ module, name, kind }))
		.sort(byName),
	exports: WebAssembly.Module.exports(module)
		.map(({ name, kind }) => ({ name, kind }))
		.sort(byName),
};

process.stdout.write(`${JSON.stringify(abi, null, "\t")}\n`);
