import { createReadStream, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";

export interface LocalServingOptions {
	readonly isolated: boolean;
	readonly pinsDirectory: string;
}

export type LocalServingHandler = (
	request: IncomingMessage,
	response: ServerResponse,
	next: () => void,
) => void;

const ISOLATION_HEADERS = {
	"Cross-Origin-Opener-Policy": "same-origin",
	"Cross-Origin-Embedder-Policy": "require-corp",
	"Cross-Origin-Resource-Policy": "same-origin",
} as const;

const PIN_CONTENT_TYPES: Readonly<Record<string, string>> = {
	".wasm": "application/wasm",
	".json": "application/json",
};

const ENGINES_PREFIX = "/engines/";

const fileSize = (path: string): number | undefined => {
	try {
		const stats = statSync(path);
		return stats.isFile() ? stats.size : undefined;
	} catch {
		return undefined;
	}
};

const failRead = (response: ServerResponse): void => {
	if (response.headersSent) {
		response.destroy();
		return;
	}
	response.removeHeader("Content-Length");
	response.statusCode = 500;
	response.setHeader("Content-Type", "text/plain");
	response.end("The pin could not be read");
};

const servePin = (root: string, path: string, response: ServerResponse): boolean => {
	const file = resolve(root, `.${path.slice(ENGINES_PREFIX.length - 1)}`);
	const contentType = PIN_CONTENT_TYPES[extname(file)];
	const size = fileSize(file);
	if (!file.startsWith(`${root}${sep}`) || !contentType || size === undefined) return false;
	response.setHeader("Content-Type", contentType);
	response.setHeader("Content-Length", size);
	response.setHeader("Cache-Control", "no-cache");
	const stream = createReadStream(file);
	stream.on("error", () => failRead(response));
	stream.pipe(response);
	return true;
};

const decodedPath = (url: string | undefined): string | undefined => {
	try {
		return decodeURIComponent(new URL(url ?? "/", "http://localhost").pathname);
	} catch {
		return undefined;
	}
};

export const localServingHandler = (options: LocalServingOptions): LocalServingHandler => {
	const root = resolve(options.pinsDirectory);
	return (request, response, next) => {
		if (options.isolated) {
			for (const [name, value] of Object.entries(ISOLATION_HEADERS)) {
				response.setHeader(name, value);
			}
		}
		const path = decodedPath(request.url);
		if (path?.startsWith(ENGINES_PREFIX) && servePin(root, path, response)) return;
		next();
	};
};
