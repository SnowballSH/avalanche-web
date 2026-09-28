import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { localServingHandler } from "../../scripts/local-serving";

let directory: string;
let server: Server;

const listen = async (isolated: boolean): Promise<string> => {
	const handle = localServingHandler({ isolated, pinsDirectory: directory });
	server = createServer((request, response) =>
		handle(request, response, () => {
			response.statusCode = 404;
			response.end("next");
		}),
	);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "pins-"));
	mkdirSync(join(directory, "pin"));
	writeFileSync(join(directory, "pins.json"), '{"abi":1}');
	writeFileSync(join(directory, "pin", "avalanche.wasm"), new Uint8Array([0, 97, 115, 109]));
});

afterEach(async () => {
	await new Promise((resolve) => server.close(resolve));
	chmodSync(join(directory, "pin", "avalanche.wasm"), 0o644);
	rmSync(directory, { recursive: true, force: true });
});

describe("localServingHandler", () => {
	it("serves a pin as application/wasm with the isolation headers", async () => {
		const origin = await listen(true);
		const response = await fetch(`${origin}/engines/pin/avalanche.wasm`);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("application/wasm");
		expect(response.headers.get("cross-origin-embedder-policy")).toBe("require-corp");
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0, 97, 115, 109]));
	});

	it("omits the isolation headers when isolation is off", async () => {
		const origin = await listen(false);
		const response = await fetch(`${origin}/engines/pins.json`);
		expect(await response.text()).toBe('{"abi":1}');
		expect(response.headers.get("cross-origin-opener-policy")).toBeNull();
	});

	it("passes paths outside the pins directory on", async () => {
		const origin = await listen(true);
		const response = await fetch(`${origin}/engines/..%2F..%2Fetc%2Fpasswd.json`);
		expect(await response.text()).toBe("next");
	});

	it("answers 500 instead of hanging when the pin cannot be read", async () => {
		chmodSync(join(directory, "pin", "avalanche.wasm"), 0);
		const origin = await listen(true);
		const response = await fetch(`${origin}/engines/pin/avalanche.wasm`, {
			signal: AbortSignal.timeout(5_000),
		});
		expect(response.status).toBe(500);
	});
});
