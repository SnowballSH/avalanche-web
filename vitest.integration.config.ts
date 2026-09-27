import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: { $lib: fileURLToPath(new URL("./src/lib", import.meta.url)) },
	},
	test: {
		include: ["tests/integration/**/*.test.ts"],
		environment: "node",
		fileParallelism: false,
		testTimeout: 60_000,
		hookTimeout: 60_000,
	},
});
