import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.AVALANCHE_SERVE_PORT ?? 8095);
const image = process.env.AVALANCHE_IMAGE ?? "avalanche-web:local";
const baseURL = `http://127.0.0.1:${port}`;

const browserSpecs = /\/(served|served-pages|shell)\.spec\.ts$/;

export default defineConfig({
	testDir: "tests/e2e",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	reporter: process.env.CI ? "github" : "list",
	use: {
		baseURL,
		trace: "on-first-retry",
	},
	projects: [
		{ name: "http", testMatch: /\/headers\.spec\.ts$/ },
		{ name: "chromium", testMatch: browserSpecs, use: { ...devices["Desktop Chrome"] } },
		{ name: "webkit", testMatch: browserSpecs, use: { ...devices["Desktop Safari"] } },
	],
	webServer: {
		command: `scripts/serve-image.sh ${image} ${port}`,
		url: `${baseURL}/health/ready`,
		reuseExistingServer: false,
		timeout: 60_000,
		gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
		stdout: "ignore",
		stderr: "pipe",
	},
});
