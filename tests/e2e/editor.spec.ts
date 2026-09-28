import { expect, type Page, test } from "@playwright/test";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const openEditor = async (page: Page, fen?: string) => {
	await page.goto(fen === undefined ? "/editor" : `/editor?${new URLSearchParams({ fen })}`);
	await expect(page.locator("cg-board piece").first()).toBeVisible();
};

const squareCentre = async (page: Page, square: string) => {
	const board = page.locator("cg-board");
	await board.evaluate((element) => element.scrollIntoView({ block: "center" }));
	const box = await board.boundingBox();
	if (!box) throw new Error("the board is not visible");
	const file = square.charCodeAt(0) - "a".charCodeAt(0);
	const rank = Number(square[1]) - 1;
	return {
		x: box.x + ((file + 0.5) * box.width) / 8,
		y: box.y + ((7 - rank + 0.5) * box.height) / 8,
	};
};

const clickSquare = async (page: Page, square: string) => {
	const { x, y } = await squareCentre(page, square);
	await page.mouse.click(x, y);
};

const dragSquares = async (page: Page, from: string, to: string) => {
	const start = await squareCentre(page, from);
	const end = await squareCentre(page, to);
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(end.x, end.y, { steps: 8 });
	await page.mouse.up();
};

const editorFen = (page: Page) => page.getByTestId("editor-fen");

const validation = (page: Page) => page.getByTestId("editor-validation");

const analyse = (page: Page) => page.getByRole("button", { name: "Analyse" });

const play = (page: Page) => page.getByRole("button", { name: "Play from here" });

test("places and removes pieces", async ({ page }) => {
	await openEditor(page);
	await expect(editorFen(page)).toHaveValue(START_FEN);
	await page.getByRole("button", { name: "Clear board" }).click();
	await expect(editorFen(page)).toHaveValue("8/8/8/8/8/8/8/8 w - - 0 1");
	await expect(validation(page)).toHaveText("Illegal position: the board is empty");

	await page.getByRole("button", { name: "White king" }).click();
	await clickSquare(page, "e1");
	await page.getByRole("button", { name: "Black king" }).click();
	await clickSquare(page, "e8");
	await page.getByRole("button", { name: "White queen" }).click();
	await clickSquare(page, "d4");
	await expect(editorFen(page)).toHaveValue("4k3/8/8/8/3Q4/8/8/4K3 w - - 0 1");
	await expect(validation(page)).toHaveText("Legal position.");
	await expect(analyse(page)).toBeEnabled();

	await page.getByRole("button", { name: "Erase" }).click();
	await clickSquare(page, "e8");
	await expect(editorFen(page)).toHaveValue("8/8/8/8/3Q4/8/8/4K3 w - - 0 1");
	await expect(validation(page)).toHaveText("Illegal position: each side needs exactly one king");
});

test("moves a piece by dragging and removes one dragged off the board", async ({ page }) => {
	await openEditor(page);
	await dragSquares(page, "e2", "e4");
	await expect(editorFen(page)).toHaveValue(
		"rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1",
	);
	const box = await page.locator("cg-board").boundingBox();
	if (!box) throw new Error("the board is not visible");
	const from = await squareCentre(page, "d2");
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width + 80, from.y, { steps: 8 });
	await page.mouse.up();
	await expect(editorFen(page)).toHaveValue(
		"rnbqkbnr/pppppppp/8/8/4P3/8/PPP2PPP/RNBQKBNR w KQkq - 0 1",
	);
});

test("sets the side to move, castling rights and en passant square", async ({ page }) => {
	await openEditor(page, "4k3/8/8/3pP3/8/8/8/R3K3 w - - 0 2");
	const enPassant = page.getByLabel("En passant");
	await enPassant.selectOption("d6");
	await expect(editorFen(page)).toHaveValue("4k3/8/8/3pP3/8/8/8/R3K3 w - d6 0 2");
	await expect(validation(page)).toHaveText("Legal position.");

	await page.getByLabel("White O-O-O").check();
	await expect(editorFen(page)).toHaveValue("4k3/8/8/3pP3/8/8/8/R3K3 w Q d6 0 2");
	await page.getByLabel("White O-O", { exact: true }).check();
	await expect(validation(page)).toHaveText(
		"Legal position. It will open as 4k3/8/8/3pP3/8/8/8/R3K3 w Q d6 0 2",
	);

	await page.getByLabel("Black", { exact: true }).check();
	await expect(editorFen(page)).toHaveValue("4k3/8/8/3pP3/8/8/8/R3K3 b KQ - 0 2");
	await expect(enPassant).toHaveValue("");

	await page.getByLabel("White", { exact: true }).check();
	await enPassant.selectOption("d6");
	await page.getByRole("button", { name: "Erase" }).click();
	await clickSquare(page, "d5");
	await expect(validation(page)).toHaveText(
		"The en passant square d6 needs a black pawn that has just advanced two squares past it, with both squares it crossed empty",
	);
	await expect(analyse(page)).toBeDisabled();
});

test("an invalid position disables Analyse and Play with a reason", async ({ page }) => {
	await openEditor(page, "4k3/8/8/8/8/8/8/5K1R w K - 0 1");
	const reason =
		"This position's castling rights need Chess960 rules: start it as an FRC game, or remove the castling rights";
	await expect(validation(page)).toHaveText(reason);
	await expect(analyse(page)).toBeDisabled();
	await expect(play(page)).toBeDisabled();
	await expect(analyse(page)).toHaveAccessibleDescription(reason);

	await page.getByLabel("White O-O", { exact: true }).uncheck();
	await expect(analyse(page)).toBeEnabled();
	await expect(play(page)).toBeEnabled();
});

test("a malformed FEN is refused and the board is kept", async ({ page }) => {
	await openEditor(page);
	await editorFen(page).fill("rnbqkbnr/pppppppp w KQkq - 0 1");
	await page.getByRole("button", { name: "Load FEN" }).click();
	await expect(page.getByRole("alert")).toHaveText("Invalid FEN: the board field is malformed");
	await expect(page.locator("cg-board piece")).toHaveCount(32);
});

test("round-trips a position through the analysis board", async ({ page }) => {
	const fen = "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2";
	await openEditor(page, fen);
	await expect(page.getByLabel("En passant")).toHaveValue("d6");
	await analyse(page).click();
	await expect(page).toHaveURL(/\/analysis#fen=4k3\/8\/8\/3pP3\/8\/8\/8\/4K3_w_-_d6_0_2$/);
	await expect(page.getByTestId("current-fen")).toHaveValue(fen);

	await page.getByRole("link", { name: "Edit this position in the board editor" }).click();
	await expect(page).toHaveURL(/\/editor\?fen=/);
	await expect(editorFen(page)).toHaveValue(fen);
});

test("opens the play page with the position in its setup", async ({ page }) => {
	const fen = "4k3/8/8/8/8/8/8/4K2R w K - 0 1";
	await openEditor(page, fen);
	await play(page).click();
	await expect(page).toHaveURL(/\/play$/);
	await expect(page.getByRole("dialog", { name: "New game" }).getByLabel("Start FEN")).toHaveValue(
		fen,
	);
});
