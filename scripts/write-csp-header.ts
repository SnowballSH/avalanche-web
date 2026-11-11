#!/usr/bin/env node
/// <reference types="node" />
// Writes the Caddyfile snippet that sends the site's Content-Security-Policy as a
// response header: the csp directives from csp.config.ts, with script-src
// carrying every boot-script hash the build wrote into its pages' CSP meta tags.
// See docs/image.md.
//
//   node scripts/write-csp-header.ts <build dir> <snippet.caddy>

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { csp } from "../csp.config.ts";
import { type BuiltPage, type CspDirectives, headerPolicy } from "./lib/csp-policy.ts";

const [buildDir, snippetPath, ...rest] = process.argv.slice(2);
if (buildDir === undefined || snippetPath === undefined || rest.length > 0) {
	console.error("usage: write-csp-header.ts <build dir> <snippet.caddy>");
	process.exit(2);
}

const directives: CspDirectives = csp.directives;

const htmlFiles = (await readdir(buildDir, { recursive: true }))
	.filter((path) => path.endsWith(".html"))
	.sort();
const pages: BuiltPage[] = await Promise.all(
	htmlFiles.map(async (path) => ({ path, html: await readFile(join(buildDir, path), "utf8") })),
);

const policy = headerPolicy(directives, pages);
await writeFile(snippetPath, `header Content-Security-Policy "${policy}"\n`);
console.log(`write-csp-header: ${htmlFiles.length} page(s) → ${snippetPath}`);
