/// <reference types="node" />
import { createHash } from "node:crypto";

export type CspDirectives = Readonly<Record<string, readonly string[]>>;

export interface BuiltPage {
	readonly path: string;
	readonly html: string;
}

export class CspPolicyError extends Error {
	override readonly name = "CspPolicyError";
}

const QUOTED_KEYWORDS = new Set([
	"self",
	"unsafe-eval",
	"unsafe-hashes",
	"unsafe-inline",
	"none",
	"strict-dynamic",
	"report-sample",
	"wasm-unsafe-eval",
	"script",
]);

const HASH_SOURCE = /^'sha256-[A-Za-z0-9+/]+={0,2}'$/;
const META_TAG = /<meta\s+http-equiv="content-security-policy"\s+content="([^"]*)"\s*\/?>/i;
const SCRIPT_TAG = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
const HTML_ENTITIES: Readonly<Record<string, string>> = {
	"&amp;": "&",
	"&quot;": '"',
	"&#39;": "'",
	"&#x27;": "'",
	"&lt;": "<",
	"&gt;": ">",
};

const decodeEntities = (text: string): string =>
	text.replace(/&(?:amp|quot|#39|#x27|lt|gt);/g, (entity) => HTML_ENTITIES[entity] ?? entity);

const quoteSource = (source: string): string =>
	QUOTED_KEYWORDS.has(source) || /^(nonce|sha\d{3})-/.test(source) ? `'${source}'` : source;

const sha256Source = (text: string): string =>
	`sha256-${createHash("sha256").update(text).digest("base64")}`;

export function metaPolicy(html: string): string | undefined {
	const content = META_TAG.exec(html)?.[1];
	return content === undefined ? undefined : decodeEntities(content);
}

export function inlineScriptSources(html: string): string[] {
	return [...html.matchAll(SCRIPT_TAG)]
		.filter(([, attributes]) => !/\ssrc\s*=/i.test(attributes ?? ""))
		.map(([, , body]) => sha256Source(body ?? ""));
}

function parsePolicy(policy: string): Map<string, string[]> {
	const parsed = new Map<string, string[]>();
	for (const directive of policy.split(";")) {
		const [name, ...sources] = directive.trim().split(/\s+/);
		if (name) parsed.set(name.toLowerCase(), sources);
	}
	return parsed;
}

function pageHashes(directives: CspDirectives, page: BuiltPage): string[] {
	const policy = metaPolicy(page.html);
	if (policy === undefined) throw new CspPolicyError(`${page.path} has no CSP meta tag`);
	const meta = parsePolicy(policy);
	for (const name of meta.keys()) {
		if (!(name in directives)) {
			throw new CspPolicyError(`${page.path} carries ${name}, which kit.csp does not configure`);
		}
	}
	const scriptSources = meta.get("script-src") ?? [];
	const hashes = scriptSources.filter((source) => HASH_SOURCE.test(source));
	for (const [name, configured] of Object.entries(directives)) {
		const emitted = meta.get(name);
		if (emitted === undefined) continue;
		const expected = configured.map(quoteSource).join(" ");
		const actual = emitted.filter((source) => !HASH_SOURCE.test(source)).join(" ");
		if (actual !== expected) {
			throw new CspPolicyError(
				`${page.path} sends ${name} ${actual}, not the configured ${expected}`,
			);
		}
	}
	for (const source of inlineScriptSources(page.html)) {
		if (!hashes.includes(`'${source}'`)) {
			throw new CspPolicyError(
				`${page.path} has an inline script ('${source}') its CSP does not allow`,
			);
		}
	}
	return hashes;
}

export function headerPolicy(directives: CspDirectives, pages: readonly BuiltPage[]): string {
	if (pages.length === 0) throw new CspPolicyError("the build has no HTML page");
	const hashes = [...new Set(pages.flatMap((page) => pageHashes(directives, page)))].sort();
	if (hashes.length === 0) {
		throw new CspPolicyError("the build's pages carry no boot-script hash for script-src");
	}
	return Object.entries(directives)
		.map(([name, sources]) =>
			[name, ...sources.map(quoteSource), ...(name === "script-src" ? hashes : [])].join(" "),
		)
		.join("; ");
}
