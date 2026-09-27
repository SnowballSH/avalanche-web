#!/usr/bin/env node
/// <reference types="node" />
// Reads engines/pins.json, validating it against the catalogue schema.
//
//   node scripts/pins-catalogue.ts list <pins.json>
//     prints one "<id>\t<commit>" line per pin, for build-pins.sh to iterate
//   node scripts/pins-catalogue.ts emit <pins.json> <outdir>
//     writes <outdir>/engines/pins.json with each pin's sha256 and bytes, measured
//     from <outdir>/engines/<id>/avalanche.wasm

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	type PinMeasurement,
	type PinSource,
	parsePinCatalogueSource,
	withMeasurements,
} from "../src/lib/pins/catalogue-source.ts";

function usage(): never {
	console.error("usage: pins-catalogue.ts list <pins.json> | emit <pins.json> <outdir>");
	process.exit(2);
}

const [command, sourcePath, outdir] = process.argv.slice(2);
const validInvocation =
	(command === "list" && sourcePath !== undefined && outdir === undefined) ||
	(command === "emit" && sourcePath !== undefined && outdir !== undefined);
if (!validInvocation || sourcePath === undefined) usage();
const source = parsePinCatalogueSource(JSON.parse(await readFile(sourcePath, "utf8")));

const wasmPathOf = (root: string, pin: PinSource): string =>
	join(root, "engines", pin.id, "avalanche.wasm");

function measure(root: string): (pin: PinSource) => PinMeasurement {
	return (pin) => {
		const bytes = readFileSync(wasmPathOf(root, pin));
		return { sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.byteLength };
	};
}

if (command === "list") {
	process.stdout.write(source.pins.map((pin) => `${pin.id}\t${pin.commit}\n`).join(""));
} else if (outdir !== undefined) {
	const served = withMeasurements(source, measure(outdir));
	const target = join(outdir, "engines", "pins.json");
	await writeFile(target, `${JSON.stringify(served, null, "\t")}\n`);
	for (const pin of served.pins) console.log(`${pin.id}\t${pin.sha256}\t${pin.bytes}`);
	console.log(`pins-catalogue: wrote ${target}`);
}
