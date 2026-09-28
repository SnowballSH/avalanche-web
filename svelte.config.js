import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({ fallback: "index.html" }),
		csp: {
			mode: "hash",
			directives: {
				"default-src": ["self"],
				"script-src": ["self", "wasm-unsafe-eval"],
				"worker-src": ["self"],
				"style-src": ["self", "unsafe-inline"],
				"img-src": ["self", "data:"],
				"connect-src": ["self"],
				"frame-ancestors": ["none"],
				"base-uri": ["none"],
				"form-action": ["none"],
			},
		},
	},
};

export default config;
