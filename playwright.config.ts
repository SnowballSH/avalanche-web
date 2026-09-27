import { defineConfig, devices } from "@playwright/test";

const port = 4173;

export default defineConfig({
	testDir: "tests/e2e",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	reporter: process.env.CI ? "github" : "list",
	use: {
		baseURL: `http://127.0.0.1:${port}`,
		trace: "on-first-retry",
	},
	projects: [
		{ name: "chromium", use: { ...devices["Desktop Chrome"] } },
		{ name: "webkit", use: { ...devices["Desktop Safari"] } },
	],
	webServer: {
		command: `npm run build && npm run preview -- --port ${port} --host 127.0.0.1`,
		url: `http://127.0.0.1:${port}/analysis`,
		env: { BOARD_HARNESS: "1" },
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
