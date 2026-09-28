import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	type CspDirectives,
	CspPolicyError,
	headerPolicy,
	inlineScriptSources,
	metaPolicy,
} from "../../scripts/lib/csp-policy";
import config from "../../svelte.config.js";

const directives: CspDirectives = {
	"default-src": ["self"],
	"script-src": ["self", "wasm-unsafe-eval"],
	"style-src": ["self", "unsafe-inline"],
	"img-src": ["self", "data:"],
	"frame-ancestors": ["none"],
	"base-uri": ["none"],
};

const sourceOf = (script: string): string =>
	`sha256-${createHash("sha256").update(script).digest("base64")}`;

const page = (script: string, policy: string, path = "page.html") => ({
	path,
	html: `<!doctype html><html><head><script src="./theme-init.js"></script><meta http-equiv="content-security-policy" content="${policy}"></head><body><script>${script}</script></body></html>`,
});

const kitMeta = (script: string): string =>
	`default-src 'self'; img-src 'self' data:; script-src 'self' 'wasm-unsafe-eval' '${sourceOf(script)}'; style-src 'self' 'unsafe-inline'; base-uri 'none'`;

function rejection(run: () => unknown): string {
	try {
		run();
	} catch (error) {
		if (error instanceof CspPolicyError) return error.message;
		throw error;
	}
	throw new Error("expected the pages to be rejected");
}

describe("metaPolicy", () => {
	it("reads the content of SvelteKit's CSP meta tag, decoding entities", () => {
		expect(
			metaPolicy(
				`<meta http-equiv="content-security-policy" content="default-src &#39;self&#39;; a &amp; b">`,
			),
		).toBe("default-src 'self'; a & b");
	});

	it("is undefined when the page carries no CSP meta tag", () => {
		expect(metaPolicy("<html><head></head></html>")).toBeUndefined();
	});
});

describe("inlineScriptSources", () => {
	it("hashes each inline script body and skips external scripts", () => {
		expect(inlineScriptSources(page("boot()", "x").html)).toEqual([sourceOf("boot()")]);
	});
});

describe("headerPolicy", () => {
	it("serialises the configured directives in order, adding the pages' boot-script hashes", () => {
		const first = page("boot(1)", kitMeta("boot(1)"), "a.html");
		const second = page("boot(2)", kitMeta("boot(2)"), "b.html");
		const hashes = [sourceOf("boot(1)"), sourceOf("boot(2)")].sort().map((hash) => `'${hash}'`);
		expect(headerPolicy(directives, [second, first])).toBe(
			[
				"default-src 'self'",
				`script-src 'self' 'wasm-unsafe-eval' ${hashes.join(" ")}`,
				"style-src 'self' 'unsafe-inline'",
				"img-src 'self' data:",
				"frame-ancestors 'none'",
				"base-uri 'none'",
			].join("; "),
		);
	});

	it("lists a hash shared by several pages once", () => {
		const policy = headerPolicy(directives, [
			page("same()", kitMeta("same()"), "a.html"),
			page("same()", kitMeta("same()"), "b.html"),
		]);
		expect(policy.match(/'sha256-/g)).toHaveLength(1);
	});

	it("rejects a page without a CSP meta tag", () => {
		expect(
			rejection(() => headerPolicy(directives, [{ path: "x.html", html: "<html></html>" }])),
		).toMatch(/x\.html.*no CSP meta/);
	});

	it("rejects a page whose inline script the meta does not allow", () => {
		expect(rejection(() => headerPolicy(directives, [page("evil()", kitMeta("boot()"))]))).toMatch(
			/inline script/,
		);
	});

	it("rejects a meta that disagrees with the configured directives", () => {
		const drifted = kitMeta("boot()").replace("img-src 'self' data:", "img-src 'self'");
		expect(rejection(() => headerPolicy(directives, [page("boot()", drifted)]))).toMatch(/img-src/);
	});

	it("rejects a meta carrying a directive the configuration does not", () => {
		const extra = `${kitMeta("boot()")}; object-src 'none'`;
		expect(rejection(() => headerPolicy(directives, [page("boot()", extra)]))).toMatch(
			/object-src/,
		);
	});

	it("rejects an empty build", () => {
		expect(rejection(() => headerPolicy(directives, []))).toMatch(/no HTML page/);
	});

	it("rejects a build whose pages yield no boot-script hash, since script-src would allow no inline boot", () => {
		const unhashed = kitMeta("boot()").replace(/ 'sha256-[^']+'/, "");
		const withoutInlineScript = {
			path: "static.html",
			html: `<html><head><meta http-equiv="content-security-policy" content="${unhashed}"></head></html>`,
		};
		expect(rejection(() => headerPolicy(directives, [withoutInlineScript]))).toMatch(
			/no boot-script hash/,
		);
	});

	it("rejects a page with an inline script whose meta lists no hash at all", () => {
		const unhashed = kitMeta("boot()").replace(/ 'sha256-[^']+'/, "");
		expect(rejection(() => headerPolicy(directives, [page("boot()", unhashed)]))).toMatch(
			/inline script/,
		);
	});

	it("accepts the repository's own kit.csp configuration", () => {
		const configured = config.kit?.csp?.directives as CspDirectives;
		const meta = kitMeta("boot()")
			.replace("default-src 'self';", "default-src 'self'; worker-src 'self'; connect-src 'self';")
			.concat("; form-action 'none'");
		expect(headerPolicy(configured, [page("boot()", meta)])).toBe(
			`default-src 'self'; script-src 'self' 'wasm-unsafe-eval' '${sourceOf("boot()")}'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
		);
	});
});
