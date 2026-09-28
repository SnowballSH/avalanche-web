import { expect, type Page, test } from "@playwright/test";
import { PIN_CACHE_NAME, pinCacheKey } from "../../src/lib/pins/cache-key";
import type { PinCatalogData, PinEntry } from "../../src/lib/pins/types";

const DEEP_LINKS = [
	"/analysis",
	"/play?fen=8%2F8%2F8%2F8%2F8%2F8%2F8%2FK6k%20w%20-%20-%200%201",
	"/engines",
	"/editor",
];

declare global {
	interface Window {
		cspViolations: string[];
	}
}

const recordCspViolations = async (page: Page): Promise<void> => {
	await page.addInitScript(() => {
		window.cspViolations = [];
		document.addEventListener("securitypolicyviolation", (event) => {
			window.cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`);
		});
	});
};

const expectBooted = async (page: Page): Promise<void> => {
	const root = page.locator("html");
	const before = await root.getAttribute("data-theme");
	await page.getByRole("button", { name: /Switch to (light|dark) theme/ }).click();
	await expect(root).toHaveAttribute("data-theme", before === "light" ? "dark" : "light");
};

test("the app boots under the served CSP without a single violation", async ({ page }) => {
	const consoleProblems: string[] = [];
	page.on("console", (message) => {
		if (/content security policy|refused to/i.test(message.text())) {
			consoleProblems.push(message.text());
		}
	});
	await recordCspViolations(page);
	for (const path of ["/analysis", "/engines", "/play"]) {
		await page.goto(path);
		await expectBooted(page);
		expect(await page.evaluate(() => window.cspViolations), path).toEqual([]);
	}
	expect(consoleProblems).toEqual([]);
});

test("the page is cross-origin isolated", async ({ page }) => {
	await page.goto("/analysis");
	expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(true);
});

test("reloading a deep link serves the app, not a 404", async ({ page }) => {
	for (const path of DEEP_LINKS) {
		await page.goto(path);
		const response = await page.reload();
		expect(response?.status(), path).toBe(200);
		await expect(page.getByRole("navigation", { name: "Site" }), path).toBeVisible();
		await expectBooted(page);
	}
});

test("the browser downloads the pin byte-exact and Cache Storage keeps the Content-Length the PinStore writes", async ({
	page,
}) => {
	await page.goto("/engines");
	const { pins } = (await (await page.request.get("/engines/pins.json")).json()) as PinCatalogData;
	const pin = pins[0] as PinEntry;
	const stored = await page.evaluate(
		async ({ pin, cacheName, key }) => {
			const response = await fetch(`/engines/${pin.id}/avalanche.wasm`);
			const bytes = new Uint8Array(await response.arrayBuffer());
			const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
			const sha256 = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
			const cache = await caches.open(cacheName);
			await cache.put(
				key,
				new Response(bytes, {
					headers: { "Content-Type": "application/wasm", "Content-Length": String(bytes.length) },
				}),
			);
			const cached = await cache.match(key);
			await caches.delete(cacheName);
			return {
				bytes: bytes.length,
				sha256,
				contentLength: cached?.headers.get("Content-Length") ?? null,
			};
		},
		{ pin, cacheName: PIN_CACHE_NAME, key: pinCacheKey(pin) },
	);
	expect(stored).toEqual({
		bytes: pin.bytes,
		sha256: pin.sha256,
		contentLength: String(pin.bytes),
	});
});

test("no request leaves the origin", async ({ page, baseURL }) => {
	const offOrigin: string[] = [];
	page.on("request", (request) => {
		const url = new URL(request.url());
		if (!["data:", "blob:"].includes(url.protocol) && url.origin !== baseURL) {
			offOrigin.push(request.url());
		}
	});
	for (const path of ["/", "/analysis", "/engines", "/play"]) {
		await page.goto(path);
		await expectBooted(page);
	}
	await page.getByRole("link", { name: "Engines" }).click();
	await expect(page).toHaveURL(/\/engines$/);
	expect(offOrigin).toEqual([]);
});
