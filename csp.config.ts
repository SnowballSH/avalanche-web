import type { Config } from "@sveltejs/kit/vite";

export const csp = {
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
} as const satisfies Config["csp"];
