import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BrowserType, expect, type Page, type Route, test } from "@playwright/test";

const PIN_ID = "master-9b7ee6f";
const PIN_LABEL = "4.0.0+ (master, 2026-09-27)";
const PIN_COMMIT = "9b7ee6ff829dcfb5ee5e48d8dcb83bd44c26a642";
const WASM_URL = `**/engines/${PIN_ID}/avalanche.wasm`;
const DOWNLOAD_TIMEOUT = 60_000;

const successor = {
	id: "test-successor",
	commit: "a".repeat(40),
	label: "Test successor",
	date: "2026-09-28",
	sha256: "b".repeat(64),
	bytes: 1_000,
};

const pinRow = (page: Page, id: string) =>
	page.locator(`[data-testid="pin-row"][data-pin-id="${id}"]`);

const pinState = (page: Page, id: string) => pinRow(page, id).getByTestId("pin-state");

const usage = (page: Page) => page.getByTestId("storage-usage");

const cachedKeys = (page: Page) =>
	page.evaluate(async () => {
		const cache = await caches.open("avalanche-pins-v1");
		return (await cache.keys()).map((request) => new URL(request.url).pathname);
	});

const openEngines = async (page: Page) => {
	await page.goto("/engines");
	await expect(pinRow(page, PIN_ID)).toBeVisible();
};

const download = async (page: Page) => {
	await pinRow(page, PIN_ID).getByRole("button", { name: "Download" }).click();
	await expect(pinState(page, PIN_ID)).toHaveText("Ready", { timeout: DOWNLOAD_TIMEOUT });
};

const holdWasm = async (page: Page) => {
	const { promise: released, resolve: release } = Promise.withResolvers<void>();
	const { promise: requested, resolve: markRequested } = Promise.withResolvers<void>();
	await page.route(WASM_URL, async (route: Route) => {
		markRequested();
		await released;
		await route.continue();
	});
	return { requested, release };
};

const persistentContext = async (browserType: BrowserType, baseURL: string | undefined) => {
	if (baseURL === undefined) throw new Error("the Playwright config sets no baseURL");
	const directory = await mkdtemp(join(tmpdir(), "avalanche-e2e-"));
	const context = await browserType.launchPersistentContext(directory, { baseURL });
	return {
		context,
		async [Symbol.asyncDispose]() {
			await context.close();
			await rm(directory, { recursive: true, force: true });
		},
	};
};

const serveCatalogue = async (page: Page, pins: readonly object[]) => {
	await page.route("**/engines/pins.json", (route) =>
		route.fulfill({ json: { abi: 1, pins }, headers: { "Cache-Control": "no-cache" } }),
	);
};

test("each row shows its label, commit link, date, size and state", async ({ page }) => {
	await openEngines(page);
	const row = pinRow(page, PIN_ID);
	await expect(row).toContainText(PIN_LABEL);
	await expect(row.getByRole("link", { name: "9b7ee6f" })).toHaveAttribute(
		"href",
		`https://github.com/SnowballSH/Avalanche/commit/${PIN_COMMIT}`,
	);
	await expect(row.getByTestId("pin-date")).toHaveText("2026-09-27");
	await expect(row.getByTestId("pin-size")).toHaveText("25.7 MB");
	await expect(pinState(page, PIN_ID)).toHaveText("Not downloaded");
	await expect(row.getByRole("radio", { name: "Default" })).toBeChecked();
	await expect(usage(page)).toContainText("Stored in this browser: 0 B");
	await expect(page.getByText("Safari does after seven days without a visit")).toBeVisible();
});

test("a download shows its progress, then ready; delete returns it to absent", async ({ page }) => {
	const wasm = await holdWasm(page);
	await openEngines(page);
	await pinRow(page, PIN_ID).getByRole("button", { name: "Download" }).click();
	await wasm.requested;
	await expect(pinState(page, PIN_ID)).toHaveText("Downloading 0%");
	await expect(pinRow(page, PIN_ID).getByRole("progressbar")).toBeVisible();
	wasm.release();
	await expect(pinState(page, PIN_ID)).toHaveText("Ready", { timeout: DOWNLOAD_TIMEOUT });
	await expect(usage(page)).toContainText("Stored in this browser: 25.7 MB");

	await pinRow(page, PIN_ID).getByRole("button", { name: "Delete" }).click();
	await expect(pinState(page, PIN_ID)).toHaveText("Not downloaded");
	await expect(usage(page)).toContainText("Stored in this browser: 0 B");
	expect(await cachedKeys(page)).toEqual([]);
});

test("cancelling a download leaves nothing cached", async ({ page }) => {
	const wasm = await holdWasm(page);
	await openEngines(page);
	await pinRow(page, PIN_ID).getByRole("button", { name: "Download" }).click();
	await wasm.requested;
	await pinRow(page, PIN_ID).getByRole("button", { name: "Cancel" }).click();
	await expect(pinState(page, PIN_ID)).toHaveText("Not downloaded");
	const finished = page.waitForEvent("requestfinished", (request) =>
		request.url().endsWith(`/engines/${PIN_ID}/avalanche.wasm`),
	);
	wasm.release();
	await finished;
	await expect(pinState(page, PIN_ID)).toHaveText("Not downloaded");
	await expect(pinRow(page, PIN_ID).getByRole("alert")).toHaveCount(0);
	await expect.poll(() => cachedKeys(page)).toEqual([]);
});

test("a cached pin missing from the catalogue is marked stale and can be deleted", async ({
	playwright,
	browserName,
	baseURL,
}) => {
	await using storage = await persistentContext(playwright[browserName], baseURL);
	const page = await storage.context.newPage();
	await openEngines(page);
	await download(page);

	await serveCatalogue(page, [successor]);
	await page.reload();
	await expect(pinState(page, PIN_ID)).toHaveText("Stale");
	await expect(pinRow(page, PIN_ID)).toContainText(
		"This version is no longer offered by the site. Delete it to free 25.7 MB.",
	);
	await expect(pinState(page, successor.id)).toHaveText("Not downloaded");

	await pinRow(page, PIN_ID).getByRole("button", { name: "Delete" }).click();
	await expect(pinRow(page, PIN_ID)).toHaveCount(0);
	await expect(usage(page)).toContainText("Stored in this browser: 0 B");
});

test("the default choice persists and falls back when its pin is retired", async ({ page }) => {
	const current = await page.request.get("/engines/pins.json").then((response) => response.json());
	await serveCatalogue(page, [...current.pins, successor]);
	await openEngines(page);
	await pinRow(page, successor.id).getByRole("radio", { name: "Default" }).check();
	await page.reload();
	await expect(pinRow(page, successor.id).getByRole("radio", { name: "Default" })).toBeChecked();

	await page.unrouteAll();
	await page.reload();
	await expect(pinRow(page, successor.id)).toHaveCount(0);
	await expect(pinRow(page, PIN_ID).getByRole("radio", { name: "Default" })).toBeChecked();
});

test("a full browser storage says to delete pins on this page", async ({ page }) => {
	await page.addInitScript(() => {
		Cache.prototype.put = () =>
			Promise.reject(new DOMException("The quota has been exceeded.", "QuotaExceededError"));
	});
	await openEngines(page);
	await pinRow(page, PIN_ID).getByRole("button", { name: "Download" }).click();
	await expect(pinRow(page, PIN_ID).getByRole("alert")).toHaveText(
		"The browser's storage is full. Delete engine versions you no longer need on this page, then download again.",
		{ timeout: DOWNLOAD_TIMEOUT },
	);
	await expect(pinState(page, PIN_ID)).toHaveText("Not downloaded");
});
