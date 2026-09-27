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
