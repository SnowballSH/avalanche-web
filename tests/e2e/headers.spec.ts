import { createHash } from "node:crypto";
import { constants, gunzipSync, zstdDecompressSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import { inlineScriptSources, metaPolicy } from "../../scripts/lib/csp-policy";
import type { PinCatalogData } from "../../src/lib/pins/types";
import { headerValues, type RawResponse, rawRequest } from "./helpers/raw-http";

const IMMUTABLE = "public, max-age=31536000, immutable";
const PAGES = ["/", "/analysis", "/editor", "/engines", "/licences", "/play"] as const;
const DEEP_LINKS = [
	"/analysis",
	"/play?fen=8%2F8%2F8%2F8%2F8%2F8%2F8%2FK6k%20w%20-%20-%200%201",
	"/engines",
	"/editor",
	"/licences",
];

const HTTP_ZSTD_WINDOW_LOG_MAX = 23;

const decodeHttpZstd = (bytes: Buffer): Buffer =>
	zstdDecompressSync(bytes, {
		params: { [constants.ZSTD_d_windowLogMax]: HTTP_ZSTD_WINDOW_LOG_MAX },
	});

const policyWith = (hashes: readonly string[]): string =>
	[
		"default-src 'self'",
		`script-src 'self' 'wasm-unsafe-eval' ${hashes.map((hash) => `'${hash}'`).join(" ")}`,
		"worker-src 'self'",
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data:",
		"connect-src 'self'",
		"frame-ancestors 'none'",
		"base-uri 'none'",
		"form-action 'none'",
	].join("; ");

const only = (response: RawResponse, name: string): string => {
	const values = headerValues(response, name);
	expect(values, `${name} arrives exactly once`).toHaveLength(1);
	return values[0] ?? "";
};

const hashesOf = (policy: string): string[] =>
	[...policy.matchAll(/'(sha256-[A-Za-z0-9+/]+={0,2})'/g)].map(([, hash]) => hash ?? "");

type Get = (path: string, headers?: Record<string, string>) => Promise<RawResponse>;

const client =
	(baseURL: string | undefined): Get =>
	(path, headers = {}) =>
		rawRequest(`${baseURL}${path}`, { headers });

const catalogue = async (get: Get): Promise<PinCatalogData> =>
	JSON.parse((await get("/engines/pins.json")).body.toString("utf8")) as PinCatalogData;

test("/ sends the isolation headers and a CSP whose script-src carries every page's boot-script hash", async ({
	baseURL,
}) => {
	const get = client(baseURL);
	const root = await get("/");
	expect(root.status).toBe(200);
	expect(only(root, "Cross-Origin-Opener-Policy")).toBe("same-origin");
	expect(only(root, "Cross-Origin-Embedder-Policy")).toBe("require-corp");
	expect(only(root, "Cross-Origin-Resource-Policy")).toBe("same-origin");
	expect(only(root, "Cache-Control")).toBe("no-cache");
	expect(only(root, "Content-Type")).toBe("text/html; charset=utf-8");

	const csp = only(root, "Content-Security-Policy");
	const emitted = new Set<string>();
	for (const path of PAGES) {
		const page = await get(path);
		expect(page.status, path).toBe(200);
		expect(only(page, "Content-Security-Policy"), path).toBe(csp);
		const html = page.body.toString("utf8");
		const boot = inlineScriptSources(html);
		expect(boot, `${path} has SvelteKit's inline boot script`).toHaveLength(1);
		expect(hashesOf(metaPolicy(html) ?? ""), `${path}'s meta allows its boot script`).toEqual(boot);
		for (const hash of boot) emitted.add(hash);
	}
	expect(csp).toBe(policyWith([...emitted].sort()));
});

test("deep links are served the app shell with a 200", async ({ baseURL }) => {
	const get = client(baseURL);
	for (const path of DEEP_LINKS) {
		const response = await get(path);
		expect(response.status, path).toBe(200);
		expect(only(response, "Content-Type"), path).toBe("text/html; charset=utf-8");
		expect(response.body.toString("utf8"), path).toContain("__sveltekit_");
	}
});

test("index.html and the catalogue must be revalidated; hashed assets are immutable", async ({
	baseURL,
}) => {
	const get = client(baseURL);
	expect(only(await get("/index.html"), "Cache-Control")).toBe("no-cache");
	const pins = await get("/engines/pins.json");
	expect(pins.status).toBe(200);
	expect(only(pins, "Cache-Control")).toBe("no-cache");
	expect(only(pins, "Content-Type")).toBe("application/json");

	const html = (await get("/")).body.toString("utf8");
	const asset = /\/_app\/immutable\/[^"']+\.js/.exec(html)?.[0];
	expect(asset, "the shell references a hashed asset").toBeDefined();
	const hashed = await get(asset ?? "");
	expect(hashed.status).toBe(200);
	expect(only(hashed, "Cache-Control")).toBe(IMMUTABLE);
	expect(only(hashed, "Cross-Origin-Resource-Policy")).toBe("same-origin");
});

test("a missing hashed asset or pin is a 404 that is never cached", async ({ baseURL }) => {
	const get = client(baseURL);
	for (const path of ["/_app/immutable/missing.js", "/engines/missing/avalanche.wasm"]) {
		const response = await get(path);
		expect(response.status, path).toBe(404);
		expect(only(response, "Cache-Control"), path).toBe("no-store");
		expect(only(response, "Content-Type"), path).toBe("text/plain; charset=utf-8");
	}
});

test("each pin is served precompressed as immutable application/wasm, and every encoding decodes to the catalogue's bytes", async ({
	baseURL,
}) => {
	const get = client(baseURL);
	const { pins } = await catalogue(get);
	expect(pins.length).toBeGreaterThan(0);
	for (const pin of pins) {
		const path = `/engines/${pin.id}/avalanche.wasm`;
		const variants = [
			{ accept: "zstd", encoding: "zstd", decode: decodeHttpZstd },
			{ accept: "gzip", encoding: "gzip", decode: gunzipSync },
			{ accept: "zstd, gzip, br", encoding: "zstd", decode: decodeHttpZstd },
			{ accept: "identity", encoding: undefined, decode: (bytes: Buffer) => bytes },
		];
		for (const { accept, encoding, decode } of variants) {
			const response = await get(path, { "Accept-Encoding": accept });
			const label = `${path} for Accept-Encoding: ${accept}`;
			expect(response.status, label).toBe(200);
			expect(only(response, "Content-Type"), label).toBe("application/wasm");
			expect(only(response, "Cache-Control"), label).toBe(IMMUTABLE);
			expect(only(response, "Cross-Origin-Resource-Policy"), label).toBe("same-origin");
			expect(headerValues(response, "Content-Encoding"), label).toEqual(encoding ? [encoding] : []);
			expect(Number(only(response, "Content-Length")), label).toBe(response.body.length);
			if (encoding) expect(response.body.length, label).toBeLessThan(pin.bytes);
			const decoded = decode(response.body);
			expect(decoded.length, label).toBe(pin.bytes);
			expect(createHash("sha256").update(decoded).digest("hex"), label).toBe(pin.sha256);
		}
	}
});

test("the health endpoints answer ok", async ({ baseURL }) => {
	const get = client(baseURL);
	for (const path of ["/health/live", "/health/ready"]) {
		const response = await get(path);
		expect(response.status, path).toBe(200);
		expect(response.body.toString("utf8"), path).toBe("ok");
	}
});
