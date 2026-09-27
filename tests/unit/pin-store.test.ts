import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { pinCacheKey } from "../../src/lib/pins/cache-key";
import { createPinStore, PinStoreError } from "../../src/lib/pins/store";
import type { PinEntry, PinStatus } from "../../src/lib/pins/types";

const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d];

function wasmBytes(length: number, seed: number): Uint8Array {
	const bytes = new Uint8Array(length);
	bytes.set(WASM_MAGIC);
	for (let i = WASM_MAGIC.length; i < length; i++) bytes[i] = (i * 31 + seed) & 0xff;
	return bytes;
}

function sha256(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function pinFor(id: string, bytes: Uint8Array): PinEntry {
	return {
		id,
		commit: id.padEnd(40, "0"),
		label: id,
		date: "2026-09-27",
		sha256: sha256(bytes),
		bytes: bytes.length,
	};
}

const firstBytes = wasmBytes(1000, 1);
const firstPin = pinFor("master-8c66796", firstBytes);
const secondBytes = wasmBytes(400, 2);
const secondPin = pinFor("master-910711f", secondBytes);

interface StoredEntry {
	readonly headers: Headers;
	readonly bytes: Uint8Array;
}

class FakeCache {
	readonly entries = new Map<string, StoredEntry>();
	putFailure: Error | undefined;

	async keys(): Promise<Request[]> {
		return [...this.entries.keys()].map((key) => new Request(`https://example.test${key}`));
	}

	async match(request: RequestInfo | URL): Promise<Response | undefined> {
		const entry = this.entries.get(keyOf(request));
		if (!entry) return undefined;
		return new Response(entry.bytes.slice(), { headers: entry.headers });
	}

	async put(request: RequestInfo | URL, response: Response): Promise<void> {
		if (this.putFailure) throw this.putFailure;
		const bytes = new Uint8Array(await response.arrayBuffer());
		this.entries.set(keyOf(request), { headers: new Headers(response.headers), bytes });
	}

	async delete(request: RequestInfo | URL): Promise<boolean> {
		return this.entries.delete(keyOf(request));
	}
}

function keyOf(request: RequestInfo | URL): string {
	const url = new URL(
		request instanceof Request ? request.url : String(request),
		"https://example.test",
	);
	return `${url.pathname}${url.search}`;
}

function fakeCacheStorage(cache: FakeCache): { caches: CacheStorage; opened: string[] } {
	const opened: string[] = [];
	const caches = {
		open: (name: string) => {
			opened.push(name);
			return Promise.resolve(cache as unknown as Cache);
		},
	} as unknown as CacheStorage;
	return { caches, opened };
}

interface FakeStorageManager {
	readonly manager: StorageManager;
	readonly persistCalls: number[];
	persistAnswer: boolean | Error;
}

function fakeStorageManager(quota: number | null = 1_000_000): FakeStorageManager {
	const persistCalls: number[] = [];
	const state: FakeStorageManager = {
		persistCalls,
		persistAnswer: true,
		manager: {
			estimate: () =>
				Promise.resolve(
					quota === null ? {} : { usage: 123_456, quota },
				) as Promise<StorageEstimate>,
			persist: () => {
				persistCalls.push(persistCalls.length);
				const answer = state.persistAnswer;
				return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
			},
		} as unknown as StorageManager,
	};
	return state;
}

interface StreamPlan {
	readonly bytes: Uint8Array;
	readonly chunkSize?: number;
	readonly errorAfter?: number;
	readonly status?: number;
}

function streamedResponse(plan: StreamPlan): Response {
	const chunkSize = plan.chunkSize ?? 100;
	let offset = 0;
	const body = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (plan.errorAfter !== undefined && offset >= plan.errorAfter) {
				controller.error(new TypeError("network connection was lost"));
				return;
			}
			if (offset >= plan.bytes.length) {
				controller.close();
				return;
			}
			const end = Math.min(offset + chunkSize, plan.bytes.length);
			controller.enqueue(plan.bytes.slice(offset, end));
			offset = end;
		},
	});
	return new Response(body, { status: plan.status ?? 200 });
}

function fakeFetch(plans: Record<string, () => Response>): {
	fetchFn: typeof fetch;
	urls: string[];
} {
	const urls: string[] = [];
	const fetchFn = ((input: RequestInfo | URL) => {
		const url = String(input);
		urls.push(url);
		const plan = plans[url];
		if (!plan) return Promise.reject(new TypeError(`unexpected fetch of ${url}`));
		return Promise.resolve(plan());
	}) as typeof fetch;
	return { fetchFn, urls };
}

function wasmUrl(pin: PinEntry): string {
	return `/engines/${pin.id}/avalanche.wasm`;
}

function setup(plans: Record<string, () => Response> = {}) {
	const cache = new FakeCache();
	const { caches, opened } = fakeCacheStorage(cache);
	const { fetchFn, urls } = fakeFetch(plans);
	const storage = fakeStorageManager();
	const store = createPinStore(caches, fetchFn, storage.manager);
	return { store, cache, opened, urls, storage };
}

function stateOf(statuses: readonly PinStatus[], id: string): PinStatus["state"] | undefined {
	return statuses.find((status) => ("pin" in status ? status.pin.id : status.id) === id)?.state;
}

async function failure(promise: Promise<unknown>): Promise<PinStoreError> {
	try {
		await promise;
	} catch (error) {
		if (error instanceof PinStoreError) return error;
		throw error;
	}
	throw new Error("expected a PinStoreError");
}

describe("PinStore.download", () => {
	it("reports monotonic progress against PinEntry.bytes and ends ready", async () => {
		const { store, urls } = setup({
			[wasmUrl(firstPin)]: () => streamedResponse({ bytes: firstBytes, chunkSize: 128 }),
		});
		const fractions: number[] = [];
		await store.download(firstPin, (fraction) => fractions.push(fraction));

		expect(urls).toEqual([wasmUrl(firstPin)]);
		expect(fractions.length).toBeGreaterThan(1);
		for (let i = 1; i < fractions.length; i++) {
			expect(fractions[i]).toBeGreaterThanOrEqual(fractions[i - 1] ?? 0);
		}
		expect(fractions[0]).toBeCloseTo(128 / 1000);
		expect(fractions.at(-1)).toBe(1);
		expect(stateOf(await store.list([firstPin]), firstPin.id)).toEqual({ kind: "ready" });
	});

	it("shows downloading with the current fraction while the stream is open", async () => {
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let offset = 0;
		const body = new ReadableStream<Uint8Array>({
			async pull(controller) {
				if (offset === 500) await gate;
				if (offset >= firstBytes.length) {
					controller.close();
					return;
				}
				controller.enqueue(firstBytes.slice(offset, offset + 500));
				offset += 500;
			},
		});
		const { store } = setup({ [wasmUrl(firstPin)]: () => new Response(body) });
		const seen = new Promise<number>((resolve) => {
			void store.download(firstPin, (fraction) => resolve(fraction));
		});
		expect(await seen).toBe(0.5);
		expect(stateOf(await store.list([firstPin]), firstPin.id)).toEqual({
			kind: "downloading",
			fraction: 0.5,
		});
		release();
	});

	it("caches a Response carrying Content-Type application/wasm that get() returns", async () => {
		const { store, cache, opened } = setup({
			[wasmUrl(firstPin)]: () => streamedResponse({ bytes: firstBytes }),
		});
		await store.download(firstPin);

		expect(opened).toContain("avalanche-pins-v1");
		expect([...cache.entries.keys()]).toEqual([pinCacheKey(firstPin)]);
		const response = await store.get(firstPin);
		expect(response.headers.get("Content-Type")).toBe("application/wasm");
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(firstBytes);
	});

	it("marks a sha256 mismatch corrupt and caches nothing", async () => {
		const tampered = firstBytes.slice();
		tampered[500] = (tampered[500] ?? 0) ^ 0xff;
		const { store, cache } = setup({
			[wasmUrl(firstPin)]: () => streamedResponse({ bytes: tampered }),
		});

		const error = await failure(store.download(firstPin));
		expect(error.code).toBe("corrupt");
		expect(error.pinId).toBe(firstPin.id);
		expect(cache.entries.size).toBe(0);
		expect(stateOf(await store.list([firstPin]), firstPin.id)).toEqual({ kind: "corrupt" });
	});

	it("treats a body of the wrong length as corrupt without waiting for extra bytes", async () => {
		const longer = new Uint8Array(firstBytes.length + 50);
		longer.set(firstBytes);
		const { store, cache } = setup({
			[wasmUrl(firstPin)]: () => streamedResponse({ bytes: longer }),
			[wasmUrl(secondPin)]: () => streamedResponse({ bytes: secondBytes.slice(0, 300) }),
		});

		expect((await failure(store.download(firstPin))).code).toBe("corrupt");
		expect((await failure(store.download(secondPin))).code).toBe("corrupt");
		expect(cache.entries.size).toBe(0);
	});

	it("caches nothing when the stream errors at 60%, returns to absent, and retries", async () => {
		let attempts = 0;
		const { store, cache } = setup({
			[wasmUrl(firstPin)]: () => {
				attempts += 1;
				return attempts === 1
					? streamedResponse({ bytes: firstBytes, errorAfter: 600 })
					: streamedResponse({ bytes: firstBytes });
			},
		});
		const fractions: number[] = [];

		const error = await failure(store.download(firstPin, (fraction) => fractions.push(fraction)));
		expect(error.code).toBe("network");
		expect(fractions.at(-1)).toBeCloseTo(0.6);
		expect(cache.entries.size).toBe(0);
		expect(stateOf(await store.list([firstPin]), firstPin.id)).toEqual({ kind: "absent" });

		await store.download(firstPin);
		expect(attempts).toBe(2);
		expect([...cache.entries.keys()]).toEqual([pinCacheKey(firstPin)]);
		expect(stateOf(await store.list([firstPin]), firstPin.id)).toEqual({ kind: "ready" });
	});

	it("maps an HTTP failure and a missing body to a network error", async () => {
		const { store } = setup({
			[wasmUrl(firstPin)]: () => new Response(null, { status: 404 }),
			[wasmUrl(secondPin)]: () => new Response(null, { status: 200 }),
		});
		expect((await failure(store.download(firstPin))).code).toBe("network");
		expect((await failure(store.download(secondPin))).code).toBe("network");
	});

	it("maps a rejected fetch to a network error with the cause attached", async () => {
		const reason = new TypeError("Failed to fetch");
		const store = createPinStore(
			fakeCacheStorage(new FakeCache()).caches,
			(() => Promise.reject(reason)) as typeof fetch,
			fakeStorageManager().manager,
		);
		const error = await failure(store.download(firstPin));
		expect(error.code).toBe("network");
		expect(error.cause).toBe(reason);
	});

	it("maps QuotaExceededError from the cache to a typed quota error", async () => {
		const { store, cache } = setup({
			[wasmUrl(firstPin)]: () => streamedResponse({ bytes: firstBytes }),
		});
		cache.putFailure = new DOMException("The quota has been exceeded.", "QuotaExceededError");

		const error = await failure(store.download(firstPin));
		expect(error.code).toBe("quota");
		expect(error.pinId).toBe(firstPin.id);
		expect(cache.entries.size).toBe(0);
		expect(stateOf(await store.list([firstPin]), firstPin.id)).toEqual({ kind: "absent" });
	});

	it("shares one transfer between concurrent downloads of the same pin", async () => {
		let attempts = 0;
		const { store } = setup({
			[wasmUrl(firstPin)]: () => {
				attempts += 1;
				return streamedResponse({ bytes: firstBytes });
			},
		});
		const first: number[] = [];
		const second: number[] = [];
		await Promise.all([
			store.download(firstPin, (fraction) => first.push(fraction)),
			store.download(firstPin, (fraction) => second.push(fraction)),
		]);
		expect(attempts).toBe(1);
		expect(second).toEqual(first);
		expect(second.at(-1)).toBe(1);
	});
});

describe("PinStore.get", () => {
	it("rejects with a missing error when the pin is not cached", async () => {
		const { store } = setup();
		const error = await failure(store.get(firstPin));
		expect(error.code).toBe("missing");
		expect(error.pinId).toBe(firstPin.id);
	});
});

describe("PinStore.list", () => {
	it("lists a cached entry absent from the catalogue as stale with its id, sha256 and bytes", async () => {
		const { store } = setup({
			[wasmUrl(firstPin)]: () => streamedResponse({ bytes: firstBytes }),
			[wasmUrl(secondPin)]: () => streamedResponse({ bytes: secondBytes }),
		});
		await store.download(firstPin);
		await store.download(secondPin);

		const statuses = await store.list([firstPin]);
		expect(statuses).toEqual([
			{ pin: firstPin, state: { kind: "ready" } },
			{
				id: secondPin.id,
				sha256: secondPin.sha256,
				bytes: secondPin.bytes,
				state: { kind: "stale" },
			},
		]);
	});

	it("lists a rebuilt pin's old hash as stale and the new hash as absent", async () => {
		const { store } = setup({
			[wasmUrl(firstPin)]: () => streamedResponse({ bytes: firstBytes }),
		});
		await store.download(firstPin);
		const rebuilt = { ...firstPin, sha256: "cd".repeat(32) };

		const statuses = await store.list([rebuilt]);
		expect(statuses).toEqual([
			{ pin: rebuilt, state: { kind: "absent" } },
			{ id: firstPin.id, sha256: firstPin.sha256, bytes: firstPin.bytes, state: { kind: "stale" } },
		]);
	});

	it("keeps catalogue order and reports absent pins", async () => {
		const { store } = setup();
		expect(await store.list([secondPin, firstPin])).toEqual([
			{ pin: secondPin, state: { kind: "absent" } },
			{ pin: firstPin, state: { kind: "absent" } },
		]);
	});
});

describe("PinStore.delete and usage", () => {
	it("removes the entry and updates usage()", async () => {
		const { store, cache } = setup({
			[wasmUrl(firstPin)]: () => streamedResponse({ bytes: firstBytes }),
			[wasmUrl(secondPin)]: () => streamedResponse({ bytes: secondBytes }),
		});
		await store.download(firstPin);
		await store.download(secondPin);
		expect(await store.usage()).toEqual({
			usedBytes: firstPin.bytes + secondPin.bytes,
			quotaBytes: 1_000_000,
		});

		await store.delete(firstPin.id);
		expect([...cache.entries.keys()]).toEqual([pinCacheKey(secondPin)]);
		expect(await store.usage()).toEqual({ usedBytes: secondPin.bytes, quotaBytes: 1_000_000 });
		expect(stateOf(await store.list([firstPin, secondPin]), firstPin.id)).toEqual({
			kind: "absent",
		});
		expect((await failure(store.get(firstPin))).code).toBe("missing");
	});

	it("deletes a stale entry by id and clears a corrupt mark", async () => {
		const tampered = firstBytes.slice();
		tampered[7] = 0xff;
		const { store } = setup({
			[wasmUrl(firstPin)]: () => streamedResponse({ bytes: tampered }),
			[wasmUrl(secondPin)]: () => streamedResponse({ bytes: secondBytes }),
		});
		await store.download(secondPin);
		await failure(store.download(firstPin));

		await store.delete(secondPin.id);
		await store.delete(firstPin.id);
		expect(await store.list([firstPin])).toEqual([{ pin: firstPin, state: { kind: "absent" } }]);
	});

	it("reports a null quota when the estimate carries none", async () => {
		const storage = fakeStorageManager(null);
		const store = createPinStore(
			fakeCacheStorage(new FakeCache()).caches,
			fakeFetch({}).fetchFn,
			storage.manager,
		);
		expect(await store.usage()).toEqual({ usedBytes: 0, quotaBytes: null });
	});
});

describe("PinStore.requestPersistence", () => {
	it("asks once and reports the grant", async () => {
		const { store, storage } = setup();
		expect(await store.requestPersistence()).toBe(true);
		expect(await store.requestPersistence()).toBe(true);
		expect(storage.persistCalls).toHaveLength(1);
	});

	it("tolerates a denial and a rejection", async () => {
		const denied = setup();
		denied.storage.persistAnswer = false;
		expect(await denied.store.requestPersistence()).toBe(false);

		const failing = setup();
		failing.storage.persistAnswer = new Error("persist is not available");
		expect(await failing.store.requestPersistence()).toBe(false);
		expect(failing.storage.persistCalls).toHaveLength(1);
	});
});
