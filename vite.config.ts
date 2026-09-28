import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	define: {
		__BOARD_HARNESS__: JSON.stringify(process.env.BOARD_HARNESS === "1"),
	},
	build: {
		assetsInlineLimit: 0,
	},
	test: {
		include: ["tests/unit/**/*.test.ts"],
		environment: "node",
	},
});
