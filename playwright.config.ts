import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 4173);

const nonIsolatedPort = port + 1;

export default defineConfig({
	testDir: "tests/e2e",
	testIgnore: /\/(served|served-pages|headers)\.spec\.ts$/,
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
	webServer: [
		{
			command: `npm run build && npm run preview -- --port ${port} --host 127.0.0.1 --strictPort`,
			url: `http://127.0.0.1:${port}/analysis`,
			env: { BOARD_HARNESS: "1" },
			reuseExistingServer: !process.env.CI,
			timeout: 180_000,
		},
		{
			command: `npm run preview -- --port ${nonIsolatedPort} --host 127.0.0.1 --strictPort`,
			url: `http://127.0.0.1:${nonIsolatedPort}/analysis`,
			env: { AVALANCHE_ISOLATION: "off" },
			reuseExistingServer: !process.env.CI,
			timeout: 60_000,
		},
	],
});
