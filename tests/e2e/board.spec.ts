import { expect, type Page, test } from "@playwright/test";

type Orientation = "white" | "black";

const CASTLING_FEN = "r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1";

const squareCentre = async (page: Page, key: string, orientation: Orientation) => {
	const box = await page.locator("cg-board").boundingBox();
	if (!box) throw new Error("the board has no box");
	const file = "abcdefgh".indexOf(key.charAt(0));
	const rank = Number(key.charAt(1)) - 1;
	const column = orientation === "white" ? file : 7 - file;
	const row = orientation === "white" ? 7 - rank : rank;
	return {
		x: box.x + ((column + 0.5) * box.width) / 8,
		y: box.y + ((row + 0.5) * box.height) / 8,
	};
};

const drag = async (page: Page, from: string, to: string, orientation: Orientation = "white") => {
	const start = await squareCentre(page, from, orientation);
	const end = await squareCentre(page, to, orientation);
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(end.x, end.y, { steps: 10 });
	await page.mouse.up();
};

test.beforeEach(async ({ page }) => {
	await page.goto("/dev/board");
	await expect(page.locator("cg-board piece")).toHaveCount(32);
});

test("a drag move emits its UCI move and the position advances", async ({ page }) => {
	await drag(page, "e2", "e4");
	await expect(page.getByTestId("moves")).toHaveText("e2e4");
	await expect(page.getByTestId("fen")).toContainText(" b KQkq - 0 1");
	await expect(page.locator("cg-board square.last-move")).toHaveCount(2);
});

test("a pawn reaching the last rank opens the promotion picker", async ({ page }) => {
	await page.getByLabel("Position", { exact: true }).selectOption("promotion");
	await expect(page.locator("cg-board piece")).toHaveCount(3);
	const picker = page.getByRole("dialog", { name: "Promote to" });

	await drag(page, "e7", "e8");
	await expect(picker).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(picker).toBeHidden();
	await expect(page.getByTestId("moves")).toHaveText("");

	await drag(page, "e7", "e8");
	await picker.getByRole("button", { name: "Promote to knight" }).click();
	await expect(picker).toBeHidden();
	await expect(page.getByTestId("moves")).toHaveText("e7e8n");
	await expect(page.getByTestId("fen")).toContainText("4N3/8/8/8/8/8/8/k6K b");
});

test("flip turns the board around", async ({ page }) => {
	const wrap = page.locator(".board .cg-wrap");
	await expect(wrap).toHaveClass(/orientation-white/);
	await page.getByRole("button", { name: "Flip" }).click();
	await expect(wrap).toHaveClass(/orientation-black/);
	await drag(page, "e2", "e4", "black");
	await expect(page.getByTestId("moves")).toHaveText("e2e4");
});

test("a right-click drag draws an arrow and reports the shape", async ({ page }) => {
	await page.getByLabel("Position", { exact: true }).selectOption("castling");
	await expect(page.getByTestId("fen")).toHaveText(CASTLING_FEN);
	await expect(page.locator("cg-board piece")).toHaveCount(22);
	await expect(page.locator("cg-board piece.anim, cg-board piece.fading")).toHaveCount(0);
	const arrows = page.locator(".cg-shapes line");
	await expect(arrows).toHaveCount(0);
	const start = await squareCentre(page, "e2", "white");
	const end = await squareCentre(page, "e4", "white");
	await page.mouse.move(start.x, start.y);
	await page.mouse.down({ button: "right" });
	await page.mouse.move(end.x, end.y, { steps: 10 });
	await expect(arrows).toHaveCount(1);
	await page.mouse.up({ button: "right" });
	await expect(arrows).toHaveCount(1);
	await expect(page.getByTestId("shapes")).toHaveText("e2e4");
	await expect(page.getByTestId("moves")).toHaveText("");
});

test("the engine's best move is drawn as an arrow", async ({ page }) => {
	await expect(page.locator(".cg-shapes line")).toHaveCount(1);
});

test("king onto rook castles as e1g1 in standard chess", async ({ page }) => {
	await page.getByLabel("Position", { exact: true }).selectOption("castling");
	await drag(page, "e1", "h1");
	await expect(page.getByTestId("moves")).toHaveText("e1g1");
});

test("king two squares castles as e1g1 in standard chess", async ({ page }) => {
	await page.getByLabel("Position", { exact: true }).selectOption("castling");
	await drag(page, "e1", "g1");
	await expect(page.getByTestId("moves")).toHaveText("e1g1");
});

test("king onto rook castles as e1h1 in Chess960", async ({ page }) => {
	await page.getByLabel("Position", { exact: true }).selectOption("castling");
	await page.getByLabel("Chess960").check();
	await drag(page, "e1", "h1");
	await expect(page.getByTestId("moves")).toHaveText("e1h1");
});

test("king two squares is not a Chess960 castling move", async ({ page }) => {
	await page.getByLabel("Position", { exact: true }).selectOption("castling");
	await page.getByLabel("Chess960").check();
	await drag(page, "e1", "g1");
	await drag(page, "e2", "e4");
	await expect(page.getByTestId("moves")).toHaveText("e2e4");
});

test("a Black promotion on a flipped board stacks the picker from the top", async ({ page }) => {
	await page.getByLabel("Position", { exact: true }).selectOption("blackPromotion");
	await page.getByRole("button", { name: "Flip" }).click();
	await expect(page.locator(".board .cg-wrap")).toHaveClass(/orientation-black/);
	await drag(page, "e2", "e1", "black");
	const picker = page.getByRole("dialog", { name: "Promote to" });
	await expect(picker).toBeVisible();
	await expect(picker).toHaveAttribute("aria-modal", "true");
	const queen = picker.getByRole("button", { name: "Promote to queen" });
	const knight = picker.getByRole("button", { name: "Promote to knight" });
	const target = await squareCentre(page, "e1", "black");
	const queenBox = await queen.boundingBox();
	const knightBox = await knight.boundingBox();
	if (!queenBox || !knightBox) throw new Error("the choices have no box");
	expect(Math.abs(queenBox.x + queenBox.width / 2 - target.x)).toBeLessThan(2);
	expect(Math.abs(queenBox.y + queenBox.height / 2 - target.y)).toBeLessThan(2);
	expect(knightBox.y).toBeGreaterThan(queenBox.y);
	await queen.click();
	await expect(page.getByTestId("moves")).toHaveText("e2e1q");
});

test("the promotion picker traps Tab and hands focus back to the board on close", async ({
	page,
}) => {
	await page.getByLabel("Position", { exact: true }).selectOption("promotion");
	await drag(page, "e7", "e8");
	const picker = page.getByRole("dialog", { name: "Promote to" });
	await expect(picker.getByRole("button", { name: "Promote to queen" })).toBeFocused();
	await page.keyboard.press("Shift+Tab");
	await expect(picker.getByRole("button", { name: "Promote to knight" })).toBeFocused();
	await page.keyboard.press("Tab");
	await expect(picker.getByRole("button", { name: "Promote to queen" })).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(picker).toBeHidden();
	await expect(page.locator(".board")).toBeFocused();
});

test("the eval bar and graph render, and a graph click selects a ply", async ({ page }) => {
	const bar = page.getByRole("meter", { name: "Evaluation" });
	await expect(bar).toHaveAttribute("data-score", "+0.35");
	await page.getByRole("button", { name: "Ply 2" }).click();
	await expect(page.getByTestId("selected")).toHaveText("2");
	await expect(page.getByRole("button", { name: "Ply 2" })).toHaveAttribute("aria-pressed", "true");
});
