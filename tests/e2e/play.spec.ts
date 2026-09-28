import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { makeSquare } from "chessops/util";

const ENGINE_TIMEOUT = 60_000;
const FAST_POLL = { intervals: [50] };

test.describe.configure({ timeout: 180_000 });

type Orientation = "white" | "black";

const setupDialog = (page: Page) => page.getByRole("dialog", { name: "New game" });

const playFen = (page: Page) => page.getByTestId("play-fen");

const gamePhase = (page: Page) => page.getByRole("region", { name: "Game" });

const result = (page: Page) => page.getByTestId("play-result");

const openSetup = async (page: Page) => {
	await page.goto("/play");
	const dialog = setupDialog(page);
	await expect(dialog).toBeVisible();
	await expect(dialog.getByTestId("setup-engine-status")).toHaveText("Engine ready", {
		timeout: ENGINE_TIMEOUT,
	});
	return dialog;
};

const startGame = async (page: Page, dialog: Locator) => {
	await dialog.getByRole("button", { name: "Start game" }).click();
	await expect(dialog).toBeHidden();
	await expect(gamePhase(page)).toHaveAttribute("data-phase", "playing", {
		timeout: ENGINE_TIMEOUT,
	});
};

const squareCentre = async (page: Page, key: string, orientation: Orientation) => {
	const box = await page.locator(".stage cg-board").boundingBox();
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
	await page.mouse.move(end.x, end.y, { steps: 5 });
	await page.mouse.up();
};

interface CandidateMove {
	readonly from: string;
	readonly to: string;
	readonly promotes: boolean;
}

const legalMoves = (fen: string): CandidateMove[] => {
	const position = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
	const moves: CandidateMove[] = [];
	for (const [from, dests] of position.allDests()) {
		const piece = position.board.get(from);
		for (const to of dests) {
			const rank = Math.floor(to / 8);
			moves.push({
				from: makeSquare(from),
				to: makeSquare(to),
				promotes: piece?.role === "pawn" && (rank === 0 || rank === 7),
			});
		}
	}
	return moves;
};

const seededPicker = (seed: number) => {
	let state = seed;
	return <T>(items: readonly T[]): T => {
		state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
		const item = items[state % items.length];
		if (item === undefined) throw new Error("no legal move to pick");
		return item;
	};
};

const whiteToMoveOrOver = async (page: Page): Promise<boolean> =>
	(await result(page).isVisible()) || (await playFen(page).inputValue()).split(" ")[1] === "w";

const playAsWhiteUntilResult = async (page: Page) => {
	const pick = seededPicker(7);
	for (let ply = 0; ply < 400; ply += 1) {
		await expect.poll(() => whiteToMoveOrOver(page), { ...FAST_POLL, timeout: 30_000 }).toBe(true);
		if (await result(page).isVisible()) return;
		const fen = await playFen(page).inputValue();
		const move = pick(legalMoves(fen));
		await drag(page, move.from, move.to);
		if (move.promotes) {
			await page
				.getByRole("dialog", { name: "Promote to" })
				.getByRole("button", { name: "Promote to queen" })
				.click();
		}
		await expect
			.poll(
				async () => (await result(page).isVisible()) || (await playFen(page).inputValue()) !== fen,
				{
					...FAST_POLL,
					timeout: 10_000,
				},
			)
			.toBe(true);
	}
	throw new Error("the game did not end within 400 plies");
};

test("a 1+0 game against a nodes-limited engine plays to a result and opens in analysis", async ({
	page,
}) => {
	const dialog = await openSetup(page);
	await dialog.getByLabel("White", { exact: true }).check();
	await dialog.getByLabel("Time control").selectOption("1+0");
	await dialog.getByLabel("Engine limit per move").selectOption("nodes");
	await dialog.getByLabel("Nodes", { exact: true }).fill("300");
	await startGame(page, dialog);
	await expect(page.getByTestId("clock-white")).toContainText(/^You\s*[01]:\d\d/);

	await playAsWhiteUntilResult(page);
	await expect(result(page)).toHaveText(/^(White wins|Black wins|Draw) (by|on) /);
	const finalFen = await playFen(page).inputValue();

	await page.getByRole("button", { name: "Analyse this game" }).click();
	await expect(page).toHaveURL(/\/analysis$/);
	await expect(page.getByTestId("current-fen")).toHaveValue(finalFen);
	await expect(page.getByTestId("page-status")).toHaveText("Game loaded from Play");
});

test("an FRC random start downloads a PGN with its result, Variant and FEN", async ({ page }) => {
	const dialog = await openSetup(page);
	const picker = dialog.getByRole("form", { name: "Start position" });
	await picker.getByLabel("FRC", { exact: true }).check();
	await picker.getByRole("button", { name: "Random" }).click();
	const summary = (await picker.getByTestId("frc-summary").textContent()) ?? "";
	const [, seed, backRank] = /^Position (\d+): (\w{8})$/.exec(summary.trim()) ?? [];
	expect(seed).toBeDefined();
	await startGame(page, dialog);

	const fen = await playFen(page).inputValue();
	expect(fen.split(" ")[0]?.split("/")[7]).toBe(backRank);
	expect(fen.split(" ")[0]?.split("/")[0]).toBe(backRank?.toLowerCase());

	await page.getByRole("button", { name: "Resign" }).click();
	await expect(result(page)).toHaveText("Black wins by resignation");

	const [download] = await Promise.all([
		page.waitForEvent("download"),
		page.getByRole("button", { name: "Download PGN" }).click(),
	]);
	expect(download.suggestedFilename()).toMatch(/^avalanche-\d{4}-\d{2}-\d{2}\.pgn$/);
	const pgn = await readFile(await download.path(), "utf8");
	expect(pgn).toContain('[Result "0-1"]');
	expect(pgn).toContain('[Variant "Chess960"]');
	expect(pgn).toContain(`[FEN "${fen}"]`);
	expect(pgn).toMatch(/0-1\n$/);
});

test("a game in progress resumes after a reload", async ({ page, browserName }) => {
	const dialog = await openSetup(page);
	await dialog.getByLabel("White", { exact: true }).check();
	await dialog.getByLabel("Engine limit per move").selectOption("nodes");
	await dialog.getByLabel("Nodes", { exact: true }).fill("300");
	await startGame(page, dialog);
	await drag(page, "e2", "e4");
	await expect(playFen(page)).toHaveValue(/ w \S+ \S+ \d+ 2$/, { timeout: ENGINE_TIMEOUT });
	const fen = await playFen(page).inputValue();

	await page.reload();
	await expect(setupDialog(page)).toBeHidden();
	await expect(playFen(page)).toHaveValue(fen);
	await expect(page.getByTestId("play-moves")).toContainText("e4");
	test.skip(
		browserName === "webkit",
		"Playwright's WebKit empties Cache Storage on navigation and drops the re-downloaded pin, so the engine cannot restart after a reload there",
	);
	await expect(gamePhase(page)).toHaveAttribute("data-phase", "playing", {
		timeout: ENGINE_TIMEOUT,
	});
});
