import { expect, type Page, test } from "@playwright/test";
import { type CspWatch, watchCsp } from "./helpers/csp-watch";

const ENGINE_TIMEOUT = 60_000;
const PIN_ID = "master-9b7ee6f";

test.describe.configure({ timeout: 120_000 });

let csp: CspWatch;
let offOrigin: string[];

test.beforeEach(async ({ page, baseURL }) => {
	csp = await watchCsp(page);
	offOrigin = [];
	page.on("request", (request) => {
		const url = new URL(request.url());
		if (!["data:", "blob:"].includes(url.protocol) && url.origin !== baseURL) {
			offOrigin.push(request.url());
		}
	});
});

test.afterEach(async () => {
	expect(await csp.violations()).toEqual([]);
	expect(offOrigin).toEqual([]);
});

const engineDepth = async (page: Page): Promise<number> =>
	Number.parseInt((await page.getByTestId("engine-depth").textContent()) ?? "", 10) || 0;

const squareCentre = async (page: Page, key: string) => {
	const box = await page.locator(".stage cg-board").boundingBox();
	if (!box) throw new Error("the board has no box");
	const file = "abcdefgh".indexOf(key.charAt(0));
	const rank = Number(key.charAt(1)) - 1;
	return {
		x: box.x + ((file + 0.5) * box.width) / 8,
		y: box.y + ((7 - rank + 0.5) * box.height) / 8,
	};
};

const drag = async (page: Page, from: string, to: string) => {
	const start = await squareCentre(page, from);
	const end = await squareCentre(page, to);
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(end.x, end.y, { steps: 5 });
	await page.mouse.up();
};

test("the analysis engine starts its worker and searches past depth 5", async ({ page }) => {
	await page.goto("/analysis");
	await expect(page.locator(".stage cg-board piece").first()).toBeVisible();
	expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
	await page.getByRole("switch", { name: "Engine" }).click();
	await expect(page.getByTestId("engine-status")).toHaveText("Analysing", {
		timeout: ENGINE_TIMEOUT,
	});
	await expect.poll(() => engineDepth(page), { timeout: ENGINE_TIMEOUT }).toBeGreaterThanOrEqual(5);
	await expect(page.getByTestId("pv-line").first()).toBeVisible();
});

test("a Play game answers the player's first move", async ({ page }) => {
	await page.goto("/play");
	const dialog = page.getByRole("dialog", { name: "New game" });
	await expect(dialog.getByTestId("setup-engine-status")).toHaveText("Engine ready", {
		timeout: ENGINE_TIMEOUT,
	});
	await dialog.getByLabel("White", { exact: true }).check();
	await dialog.getByLabel("Engine limit per move").selectOption("nodes");
	await dialog.getByLabel("Nodes", { exact: true }).fill("300");
	await dialog.getByRole("button", { name: "Start game" }).click();
	await expect(page.getByRole("region", { name: "Game" })).toHaveAttribute(
		"data-phase",
		"playing",
		{ timeout: ENGINE_TIMEOUT },
	);
	await drag(page, "e2", "e4");
	await expect(page.getByTestId("play-fen")).toHaveValue(/^\S+\/4P3\/\S+ w /, {
		timeout: ENGINE_TIMEOUT,
	});
});

test("the editor renders its board and position", async ({ page }) => {
	await page.goto("/editor");
	await expect(page.locator("cg-board piece")).toHaveCount(32);
	await expect(page.getByTestId("editor-fen")).toHaveValue(
		"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
	);
});

test("the Engines page lists the pin and downloads it", async ({ page }) => {
	await page.goto("/engines");
	const row = page.locator(`[data-testid="pin-row"][data-pin-id="${PIN_ID}"]`);
	await expect(row).toBeVisible();
	await row.getByRole("button", { name: "Download" }).click();
	await expect(row.getByTestId("pin-state")).toHaveText("Ready", { timeout: ENGINE_TIMEOUT });
	await row.getByRole("button", { name: "Delete" }).click();
	await expect(row.getByTestId("pin-state")).toHaveText("Not downloaded");
});
