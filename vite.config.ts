import { createReadStream, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const ISOLATION_HEADERS = {
	"Cross-Origin-Opener-Policy": "same-origin",
	"Cross-Origin-Embedder-Policy": "require-corp",
	"Cross-Origin-Resource-Policy": "same-origin",
} as const;

const PIN_CONTENT_TYPES: Readonly<Record<string, string>> = {
	".wasm": "application/wasm",
	".json": "application/json",
};

const pinsDirectory = resolve(process.env.AVALANCHE_PINS_DIR ?? "build-pins/out/engines");

const fileSize = (path: string): number | undefined => {
	try {
		const stats = statSync(path);
		return stats.isFile() ? stats.size : undefined;
	} catch {
		return undefined;
	}
};

const servePin = (path: string, response: ServerResponse): boolean => {
	const file = resolve(pinsDirectory, `.${path.slice("/engines".length)}`);
	const contentType = PIN_CONTENT_TYPES[extname(file)];
	const size = fileSize(file);
	if (!file.startsWith(`${pinsDirectory}${sep}`) || !contentType || size === undefined) {
		return false;
	}
	response.setHeader("Content-Type", contentType);
	response.setHeader("Content-Length", size);
	response.setHeader("Cache-Control", "no-cache");
	createReadStream(file).pipe(response);
	return true;
};

const localServing = (isolated: boolean): Plugin => {
	const handle = (request: IncomingMessage, response: ServerResponse, next: () => void) => {
		if (isolated) {
			for (const [name, value] of Object.entries(ISOLATION_HEADERS)) {
				response.setHeader(name, value);
			}
		}
		const path = new URL(request.url ?? "/", "http://localhost").pathname;
		if (path.startsWith("/engines/") && servePin(path, response)) return;
		next();
	};
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
	plugins: [localServing(process.env.AVALANCHE_ISOLATION !== "off"), tailwindcss(), sveltekit()],
	define: {
		__BOARD_HARNESS__: JSON.stringify(process.env.BOARD_HARNESS === "1"),
	},
	test: {
		include: ["tests/unit/**/*.test.ts"],
		environment: "node",
	},
});
