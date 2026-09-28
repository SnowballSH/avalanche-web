#!/usr/bin/env node
/// <reference types="node" />
// Writes the Caddyfile snippet that sends the site's Content-Security-Policy as a
// response header: kit.csp's directives from svelte.config.js, with script-src
// carrying every boot-script hash the build wrote into its pages' CSP meta tags.
// See docs/image.md.
//
//   node scripts/write-csp-header.ts <build dir> <snippet.caddy>

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import config from "../svelte.config.js";
import { type BuiltPage, type CspDirectives, headerPolicy } from "./lib/csp-policy.ts";

const [buildDir, snippetPath, ...rest] = process.argv.slice(2);
if (buildDir === undefined || snippetPath === undefined || rest.length > 0) {
	console.error("usage: write-csp-header.ts <build dir> <snippet.caddy>");
	process.exit(2);
}

const directives = config.kit?.csp?.directives as CspDirectives | undefined;
if (config.kit?.csp?.mode !== "hash" || directives === undefined) {
	console.error("write-csp-header: svelte.config.js must set kit.csp with mode 'hash'");
	process.exit(1);
}

const htmlFiles = (await readdir(buildDir, { recursive: true }))
	.filter((path) => path.endsWith(".html"))
	.sort();
const pages: BuiltPage[] = await Promise.all(
	htmlFiles.map(async (path) => ({ path, html: await readFile(join(buildDir, path), "utf8") })),
);

const policy = headerPolicy(directives, pages);
await writeFile(snippetPath, `header Content-Security-Policy "${policy}"\n`);
console.log(`write-csp-header: ${htmlFiles.length} page(s) → ${snippetPath}`);
