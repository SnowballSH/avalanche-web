import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { csp } from "./csp.config.ts";
import { localServingHandler } from "./scripts/local-serving.ts";

const localServing = (): Plugin => {
	const handle = localServingHandler({
		isolated: process.env.AVALANCHE_ISOLATION !== "off",
		pinsDirectory: process.env.AVALANCHE_PINS_DIR ?? "build-pins/out/engines",
	});
	return {
		name: "avalanche-local-serving",
		configureServer: (server) => {
			server.middlewares.use(handle);
		},
		configurePreviewServer: (server) => {
			server.middlewares.use(handle);
		},
	};
};

export default defineConfig({
	plugins: [
		localServing(),
		tailwindcss(),
		sveltekit({ adapter: adapter({ fallback: "index.html" }), csp }),
	],
	define: {
		__BOARD_HARNESS__: JSON.stringify(process.env.BOARD_HARNESS === "1"),
	},
	build: {
		assetsInlineLimit: 0,
	},
	test: {
		include: ["tests/unit/**/*.test.ts"],
		environment: "node",
		server: { deps: { inline: [/\/node_modules\/[^?]+(\?raw|\/package\.json)$/] } },
	},
});
