import { expect, test } from "@playwright/test";

const navigation = [
	{ label: "Analysis", href: "/analysis" },
	{ label: "Play", href: "/play" },
	{ label: "Engines", href: "/engines" },
];

test("the header links to Analysis, Play and Engines", async ({ page }) => {
	await page.goto("/analysis");
	const nav = page.getByRole("navigation", { name: "Site" });
	for (const { label, href } of navigation) {
		await expect(nav.getByRole("link", { name: label })).toHaveAttribute("href", href);
	}
});

test("the root redirects to the analysis board", async ({ page }) => {
	await page.goto("/");
	await expect(page).toHaveURL(/\/analysis$/);
});

test("the theme toggle switches the root theme attribute", async ({ page }) => {
	await page.goto("/analysis");
	const root = page.locator("html");
	const before = await root.getAttribute("data-theme");
	expect(before).toMatch(/^(light|dark)$/);
	await page.getByRole("button", { name: /Switch to (light|dark) theme/ }).click();
	const after = before === "light" ? "dark" : "light";
	await expect(root).toHaveAttribute("data-theme", after);
	await page.reload();
	await expect(root).toHaveAttribute("data-theme", after);
});

test("the footer links to the GPL source and the licences page", async ({ page }) => {
	await page.goto("/analysis");
	const legal = page.getByRole("navigation", { name: "Legal" });
	await expect(legal.getByRole("link", { name: "Source (GPL-3.0)" })).toHaveAttribute(
		"href",
		"https://github.com/SnowballSH/avalanche-web",
	);
	await legal.getByRole("link", { name: "Licences" }).click();
	await expect(page).toHaveURL(/\/licences$/);
	await expect(page.getByRole("heading", { level: 1, name: "Licences" })).toBeVisible();
	const engine = page.locator('[data-testid="licence-notice"][data-notice-id="avalanche"]');
	await engine.getByText("Licence text").click();
	await expect(engine.locator("pre")).toContainText("GNU GENERAL PUBLIC LICENSE");
});
