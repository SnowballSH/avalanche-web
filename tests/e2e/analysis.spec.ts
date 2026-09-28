import { expect, type Page, test } from "@playwright/test";
import { expectDisjoint, expectUnclipped } from "./helpers/visibility";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const NON_ISOLATED_ANALYSIS = `http://127.0.0.1:${Number(process.env.E2E_PORT ?? 4173) + 1}/analysis`;
const ENGINE_TIMEOUT = 60_000;

const openAnalysis = async (page: Page, hash = "") => {
	await page.goto(`/analysis${hash}`);
	await expect(page.locator(".stage cg-board piece").first()).toBeVisible();
};

const currentFen = (page: Page) => page.getByTestId("current-fen");

const moveList = (page: Page) => page.getByTestId("move-list");

const currentMove = (page: Page) => moveList(page).locator('[aria-current="step"]');

const moveButtons = (page: Page) => moveList(page).getByRole("button");

const importText = async (page: Page, text: string) => {
	await page.getByLabel("FEN or PGN to import").fill(text);
	await page.getByRole("button", { name: "Import", exact: true }).click();
};

const releaseFocus = (page: Page) =>
	page.evaluate(() => {
		if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
	});

const stubClipboard = (page: Page) =>
	page.addInitScript(() => {
		const written: string[] = [];
		Object.defineProperty(window, "copiedTexts", { value: written });
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: {
				writeText: async (text: string) => {
					written.push(text);
				},
			},
		});
	});

const lastCopied = (page: Page) =>
	page.evaluate(() => (window as unknown as { copiedTexts: string[] }).copiedTexts.at(-1));

const depth = async (page: Page): Promise<number> => {
	const text = (await page.getByTestId("engine-depth").textContent()) ?? "";
	return Number.parseInt(text, 10) || 0;
};

const enginePanel = (page: Page) => page.getByRole("region", { name: "Engine" });

const settingsToggle = (page: Page) =>
	enginePanel(page).getByRole("button", { name: "Settings", exact: true });

const openSettings = async (page: Page) => {
	const toggle = settingsToggle(page);
	if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
	await expect(toggle).toHaveAttribute("aria-expanded", "true");
};

const switchEngineOn = async (page: Page) => {
	expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
	await page.getByRole("switch", { name: "Engine" }).click();
	await expect(page.getByTestId("engine-status")).toHaveText("Analysing", {
		timeout: ENGINE_TIMEOUT,
	});
};

test.describe("the board, tree and import", () => {
	test("arrow keys navigate the tree", async ({ page }) => {
		await openAnalysis(page);
		await importText(page, "1. e4 (1. d4 d5) e5 2. Nf3 *");
		await expect(moveButtons(page)).toHaveText(["1. e4", "1. d4", "d5", "1… e5", "2. Nf3"]);
		await releaseFocus(page);

		await page.keyboard.press("ArrowRight");
		await expect(currentMove(page)).toHaveText("1. e4");
		await page.keyboard.press("ArrowDown");
		await expect(currentMove(page)).toHaveText("1. d4");
		await page.keyboard.press("ArrowRight");
		await expect(currentMove(page)).toHaveText("d5");
		await page.keyboard.press("ArrowLeft");
		await page.keyboard.press("ArrowUp");
		await expect(currentMove(page)).toHaveText("1. e4");
		await page.keyboard.press("ArrowRight");
		await expect(currentMove(page)).toHaveText("1… e5");
		await expect(currentFen(page)).toHaveValue(/^rnbqkbnr\/pppp1ppp\/8\/4p3\/4P3\/8\/PPPP1PPP/);
	});

	test("Home and End jump to the start and the end", async ({ page }) => {
		await openAnalysis(page);
		await importText(page, "1. e4 e5 2. Nf3 Nc6 *");
		await releaseFocus(page);
		await page.keyboard.press("End");
		await expect(currentMove(page)).toHaveText("Nc6");
		await expect(currentFen(page)).toHaveValue(
			"r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3",
		);
		await page.keyboard.press("Home");
		await expect(currentMove(page)).toHaveCount(0);
		await expect(currentFen(page)).toHaveValue(START_FEN);
	});

	test("copy line as PGN and copy FEN write the expected text", async ({ page }) => {
		await stubClipboard(page);
		await openAnalysis(page);
		await importText(page, "1. e4 e5 2. Nf3 *");
		await releaseFocus(page);
		await page.keyboard.press("End");
		await page.getByRole("button", { name: "Copy line as PGN" }).click();
		await expect.poll(() => lastCopied(page)).toContain("1. e4 e5 2. Nf3 *");

		await page.getByRole("button", { name: "Previous move" }).click();
		await page.getByRole("button", { name: "Copy line as PGN" }).click();
		await expect.poll(() => lastCopied(page)).toMatch(/\n1\. e4 e5 \*\n$/);

		await page.getByRole("button", { name: "Copy FEN" }).click();
		const fen = await currentFen(page).inputValue();
		expect(fen).toMatch(/^rnbqkbnr\/pppp1ppp\/8\/4p3\/4P3\/8\/PPPP1PPP\/RNBQKBNR w KQkq/);
		await expect.poll(() => lastCopied(page)).toBe(fen);
	});

	test("a one-line PGN with a drawn result imports as a game", async ({ page }) => {
		await openAnalysis(page);
		await importText(page, "1. d4 d5 2. c4 1/2-1/2");
		await expect(page.getByTestId("import-error")).toHaveCount(0);
		await expect(moveButtons(page)).toHaveText(["1. d4", "d5", "2. c4"]);
	});

	test("a bad paste shows an inline error and leaves the tree unchanged", async ({ page }) => {
		await openAnalysis(page);
		await importText(page, "1. e4 e5 *");
		await releaseFocus(page);
		await page.keyboard.press("End");
		const fen = await currentFen(page).inputValue();
		const error = page.getByTestId("import-error");

		await importText(page, "1. e4 e5 2. Ke3 Nc6 *");
		await expect(error).toContainText("the move Ke3 at ply 3 is illegal");
		await expect(moveButtons(page)).toHaveText(["1. e4", "e5"]);
		await expect(currentFen(page)).toHaveValue(fen);

		await importText(page, "8/8/8/8/8/8/8/8 w - - 0 1");
		await expect(error).toContainText("Illegal position");
		await expect(currentFen(page)).toHaveValue(fen);

		await importText(page, "\u0000\u0001\ufffd\ufffd PK\u0003\u0004\n\ufffd");
		await expect(error).toHaveText("No game was found in the text");
		await expect(currentFen(page)).toHaveValue(fen);
	});

	test("an import over 5 MB is refused with a clear message", async ({ page }) => {
		await openAnalysis(page);
		await page.getByLabel("FEN or PGN to import").evaluate(
			(element, size) => {
				const area = element as HTMLTextAreaElement;
				area.value = `[Event "big"]\n\n1. e4 {${"x".repeat(size)}} *`;
				area.dispatchEvent(new Event("input", { bubbles: true }));
			},
			5 * 1024 * 1024,
		);
		await page.getByRole("button", { name: "Import", exact: true }).click();
		await expect(page.getByTestId("import-error")).toHaveText(
			"The input is larger than the 5 MB import limit",
		);
		await expect(currentFen(page)).toHaveValue(START_FEN);
	});

	test("an FRC seed of 518 equals the standard start", async ({ page }) => {
		await openAnalysis(page);
		const picker = page.getByRole("form", { name: "Start position" });
		await picker.getByLabel("FRC", { exact: true }).check();
		const seed = picker.getByLabel("FRC position number");
		await seed.fill("0");
		await picker.getByRole("button", { name: "Set up board" }).click();
		await expect(currentFen(page)).toHaveValue(
			"bbqnnrkr/pppppppp/8/8/8/8/PPPPPPPP/BBQNNRKR w KQkq - 0 1",
		);

		await seed.fill("518");
		await expect(picker.getByTestId("frc-summary")).toHaveText("Position 518: RNBQKBNR");
		await picker.getByRole("button", { name: "Set up board" }).click();
		await expect(currentFen(page)).toHaveValue(START_FEN);
	});

	test("a #fen= link loads that position", async ({ page }) => {
		await openAnalysis(page, "#fen=4k3/8/8/8/8/8/8/4K2R_w_K_-_0_1");
		await expect(currentFen(page)).toHaveValue("4k3/8/8/8/8/8/8/4K2R w K - 0 1");
	});

	test("an invalid #fen= link shows an error and keeps the start position", async ({ page }) => {
		await openAnalysis(page, "#fen=not/a/fen");
		await expect(page.getByTestId("analysis-notice")).toContainText("Invalid FEN");
		await expect(currentFen(page)).toHaveValue(START_FEN);
	});
});

test.describe("the engine", () => {
	test.describe.configure({ timeout: 120_000 });

	test("switching the engine on shows the depth rising", async ({ page }) => {
		await openAnalysis(page);
		await switchEngineOn(page);
		await expect.poll(() => depth(page), { timeout: ENGINE_TIMEOUT }).toBeGreaterThan(0);
		const first = await depth(page);
		await expect.poll(() => depth(page), { timeout: ENGINE_TIMEOUT }).toBeGreaterThan(first);
		await expect(page.getByRole("meter", { name: "Evaluation" })).toHaveAttribute(
			"data-score",
			/^[+-]?\d+\.\d\d$|^-?#\d+$/,
		);
		const label = page.locator(".stage").getByTestId("eval-label");
		await expectUnclipped(label, /^[+-]?\d+\.\d\d$|^-?#\d+$/);
		await expectDisjoint(label, page.locator(".stage cg-board"));
		await expect(page.locator(".stage .cg-shapes line")).toHaveCount(1);
	});

	test("MultiPV 3 shows three lines ordered by rank", async ({ page }) => {
		await openAnalysis(page);
		await switchEngineOn(page);
		await openSettings(page);
		await page.getByLabel("Lines", { exact: true }).selectOption("3");
		const lines = page.getByTestId("pv-line");
		await expect(lines).toHaveCount(3, { timeout: ENGINE_TIMEOUT });
		const ranks = await lines.evaluateAll((items) =>
			items.map((item) => item.getAttribute("data-multipv")),
		);
		expect(ranks).toEqual(["1", "2", "3"]);
	});

	test("the engine settings start collapsed, keep the lines visible and remember being open", async ({
		page,
	}) => {
		await openAnalysis(page);
		const toggle = settingsToggle(page);
		await expect(toggle).toHaveAttribute("aria-expanded", "false");
		const controlled = await toggle.getAttribute("aria-controls");
		expect(controlled).toBeTruthy();
		await expect(page.getByLabel("Lines", { exact: true })).toBeHidden();
		await expect(page.getByLabel("Engine version", { exact: true })).toBeHidden();
		await expect(page.getByLabel("Hash", { exact: true })).toBeHidden();

		await switchEngineOn(page);
		await expect(page.getByTestId("pv-line").first()).toBeVisible({ timeout: ENGINE_TIMEOUT });
		await expect(page.getByTestId("engine-stats")).toBeVisible();
		await expect(toggle).toHaveAttribute("aria-expanded", "false");

		await toggle.focus();
		await page.keyboard.press("Enter");
		await expect(toggle).toHaveAttribute("aria-expanded", "true");
		await expect(page.locator(`#${controlled}`)).toBeVisible();
		await expect(page.getByLabel("Lines", { exact: true })).toBeVisible();
		await expect(page.getByLabel("Hash", { exact: true })).toBeVisible();
		expect(
			await page.evaluate(() => localStorage.getItem("avalanche-analysis-settings-open")),
		).toBe("true");

		await page.reload();
		await expect(page.locator(".stage cg-board piece").first()).toBeVisible();
		await expect(settingsToggle(page)).toHaveAttribute("aria-expanded", "true");
		await expect(page.getByLabel("Lines", { exact: true })).toBeVisible();

		await settingsToggle(page).focus();
		await page.keyboard.press("Space");
		await expect(settingsToggle(page)).toHaveAttribute("aria-expanded", "false");
		await page.reload();
		await expect(page.locator(".stage cg-board piece").first()).toBeVisible();
		await expect(settingsToggle(page)).toHaveAttribute("aria-expanded", "false");
		await expect(page.getByLabel("Lines", { exact: true })).toBeHidden();
	});

	test("hovering a PV previews its position and clicking it plays the line", async ({
		page,
		browserName,
	}) => {
		await openAnalysis(page);
		await switchEngineOn(page);
		const firstMove = page.getByTestId("pv-line").first().locator(".pv-move").first();
		await expect(firstMove).toBeVisible({ timeout: ENGINE_TIMEOUT });
		await firstMove.hover();
		const preview = page.getByTestId("pv-preview");
		await expect(preview.locator("cg-board piece")).toHaveCount(32);
		await expect(preview.locator("cg-board square.last-move")).toHaveCount(2);
		if (browserName === "chromium") {
			await page.keyboard.press("Shift");
			await firstMove.focus();
			const focusRing = await firstMove.evaluate((element) => ({
				visible: element.matches(":focus-visible"),
				outline: getComputedStyle(element).outlineStyle,
			}));
			expect(focusRing).toEqual({ visible: true, outline: "solid" });
		}
		const played = await firstMove.evaluate((element) => {
			const label = element.textContent?.trim() ?? "";
			(element as HTMLButtonElement).click();
			return label;
		});
		await expect(currentMove(page)).toHaveText(played);
	});

	test("an imported PGN exports with the engine's evaluations", async ({ page }) => {
		await openAnalysis(page);
		await importText(page, '[Event "Evals"]\n\n1. e4 e5 *');
		await releaseFocus(page);
		await page.keyboard.press("End");
		await switchEngineOn(page);
		await expect.poll(() => depth(page), { timeout: ENGINE_TIMEOUT }).toBeGreaterThanOrEqual(6);
		await page.getByRole("button", { name: "Export PGN" }).click();
		const exported = page.getByLabel("Exported PGN");
		await expect(exported).toHaveValue(/\[Event "Evals"\]/);
		await expect(exported).toHaveValue(/1\. e4 e5 \{ \[%eval (-?\d+\.\d+|#-?\d+),\d+\] \} \*/);
	});
});

test("without cross-origin isolation the engine refuses to run and says why", async ({ page }) => {
	await page.goto(NON_ISOLATED_ANALYSIS);
	await expect(page.locator(".stage cg-board piece").first()).toBeVisible();
	expect(await page.evaluate(() => crossOriginIsolated)).toBe(false);
	await expect(page.getByTestId("isolation-refusal")).toContainText(
		"The engine cannot run on this page.",
	);
	await expect(page.getByTestId("isolation-refusal")).toContainText("cross-origin isolated");
	await expect(page.getByRole("switch", { name: "Engine" })).toBeDisabled();
});
