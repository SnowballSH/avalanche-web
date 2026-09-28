import { describe, expect, it } from "vitest";
import { PinCatalogueError } from "../../src/lib/pins/catalogue-source";
import { createDefaultPinChoice, DEFAULT_PIN_STORAGE_KEY } from "../../src/lib/pins/default-pin";
import {
	formatBytes,
	formatUsage,
	pinCommitUrl,
	pinStateLabel,
	shortCommit,
} from "../../src/lib/pins/pin-format";
import {
	PinManager,
	type PinManagerState,
	type PinRow,
	pinErrorMessage,
} from "../../src/lib/pins/pin-manager";
import { PinStoreError } from "../../src/lib/pins/store";
import type { PinCatalogData, PinEntry } from "../../src/lib/pins/types";
import { FakePinStore, QUOTA_BYTES } from "./helpers/fake-pin-store";

const newest: PinEntry = {
	id: "master-9b7ee6f",
	commit: "9b7ee6ff829dcfb5ee5e48d8dcb83bd44c26a642",
	label: "4.0.0+ (master, 2026-09-27)",
	date: "2026-09-27",
	sha256: "c4".repeat(32),
	bytes: 25_698_005,
};

const older: PinEntry = {
	id: "master-910711f",
	commit: "910711f".padEnd(40, "0"),
	label: "3.9.0 (master, 2026-08-01)",
	date: "2026-08-01",
	sha256: "91".repeat(32),
	bytes: 24_000_000,
};

const catalogue: PinCatalogData = { abi: 1, pins: [newest, older] };

class MemoryStorage {
	readonly items = new Map<string, string>();
	getItem(key: string): string | null {
		return this.items.get(key) ?? null;
	}
	setItem(key: string, value: string): void {
		this.items.set(key, value);
	}
}

interface Fixture {
	readonly store: FakePinStore;
	readonly storage: MemoryStorage;
	readonly manager: PinManager;
	readonly states: PinManagerState[];
}

const setup = (data: PinCatalogData | Error = catalogue): Fixture => {
	const store = new FakePinStore();
	const storage = new MemoryStorage();
	const manager = new PinManager({
		store,
		catalogue: async () => {
			if (data instanceof Error) throw data;
			return data;
		},
		defaults: createDefaultPinChoice(storage),
	});
	const states: PinManagerState[] = [];
	manager.subscribe((state) => states.push(state));
	return { store, storage, manager, states };
};

const rowOf = (manager: PinManager, id: string): PinRow => {
	const row = manager.state.rows.find((entry) =>
		entry.kind === "stale" ? entry.id === id : entry.pin.id === id,
	);
	if (!row) throw new Error(`no row for ${id}`);
	return row;
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the pin rows", () => {
	it("lists every catalogue pin with its state, the default and the total usage", async () => {
		const { store, manager } = setup();
		store.cache(newest.id, newest.sha256, newest.bytes);
		await manager.load();
		expect(manager.state.status).toBe("ready");
		expect(manager.state.rows).toEqual([
			{ kind: "catalogue", pin: newest, state: { kind: "ready" }, error: null },
			{ kind: "catalogue", pin: older, state: { kind: "absent" }, error: null },
		]);
		expect(manager.state.defaultId).toBe(newest.id);
		expect(manager.state.usage).toEqual({ usedBytes: newest.bytes, quotaBytes: QUOTA_BYTES });
	});

	it("formats the commit link, the size and each state", () => {
		expect(shortCommit(newest.commit)).toBe("9b7ee6f");
		expect(pinCommitUrl(newest.commit)).toBe(
			"https://github.com/SnowballSH/Avalanche/commit/9b7ee6ff829dcfb5ee5e48d8dcb83bd44c26a642",
		);
		expect(formatBytes(newest.bytes)).toBe("25.7 MB");
		expect(formatBytes(1_536)).toBe("1.5 kB");
		expect(formatBytes(512)).toBe("512 B");
		expect(formatBytes(2_500_000_000)).toBe("2.5 GB");
		expect(formatUsage({ usedBytes: newest.bytes, quotaBytes: 2_000_000_000 })).toBe(
			"Stored in this browser: 25.7 MB of 2.0 GB available to this site",
		);
		expect(formatUsage({ usedBytes: 0, quotaBytes: null })).toBe("Stored in this browser: 0 B");
		expect(pinStateLabel({ kind: "absent" })).toBe("Not downloaded");
		expect(pinStateLabel({ kind: "downloading", fraction: 0.425 })).toBe("Downloading 42%");
		expect(pinStateLabel({ kind: "ready" })).toBe("Ready");
		expect(pinStateLabel({ kind: "corrupt" })).toBe("Corrupt");
		expect(pinStateLabel({ kind: "stale" })).toBe("Stale");
	});

	it("reports a catalogue that fails to load", async () => {
		const { manager } = setup(new PinCatalogueError("/engines/pins.json: HTTP 503"));
		await manager.load();
		expect(manager.state.status).toBe("failed");
		expect(manager.state.message).toBe(
			"The list of engine versions could not be loaded (/engines/pins.json: HTTP 503).",
		);
	});
});

describe("downloading and deleting", () => {
	it("shows download progress, then ready with the usage updated", async () => {
		const { store, manager } = setup();
		await manager.load();
		const done = manager.download(older.id);
		expect(rowOf(manager, older.id).state).toEqual({ kind: "downloading", fraction: 0 });
		store.progress(older.id, 0.5);
		expect(rowOf(manager, older.id).state).toEqual({ kind: "downloading", fraction: 0.5 });
		store.finish(older.id);
		await done;
		expect(rowOf(manager, older.id).state).toEqual({ kind: "ready" });
		expect(manager.state.usage?.usedBytes).toBe(older.bytes);
	});

	it("returns a deleted pin to absent and lowers the usage", async () => {
		const { store, manager } = setup();
		store.cache(newest.id, newest.sha256, newest.bytes);
		store.cache(older.id, older.sha256, older.bytes);
		await manager.load();
		expect(manager.state.usage?.usedBytes).toBe(newest.bytes + older.bytes);
		await manager.remove(newest.id);
		expect(rowOf(manager, newest.id).state).toEqual({ kind: "absent" });
		expect(manager.state.usage?.usedBytes).toBe(older.bytes);
	});

	it("cancels a download when the pin is deleted, without reporting an error", async () => {
		const { store, manager } = setup();
		await manager.load();
		const done = manager.download(older.id);
		store.progress(older.id, 0.3);
		await manager.remove(older.id);
		await done;
		expect(rowOf(manager, older.id)).toMatchObject({ state: { kind: "absent" }, error: null });
		expect(store.pending.size).toBe(0);
	});

	it("clears a cancelled row at once, even while the store's transfer settles later", async () => {
		const { store, manager } = setup();
		store.settleOnDelete = false;
		await manager.load();
		const cancelled = manager.download(older.id);
		await manager.remove(older.id);
		expect(rowOf(manager, older.id)).toMatchObject({ state: { kind: "absent" }, error: null });

		const retried = manager.download(older.id);
		expect(rowOf(manager, older.id).state).toEqual({ kind: "downloading", fraction: 0 });
		store.settleOrphans();
		await cancelled;
		expect(rowOf(manager, older.id)).toMatchObject({
			state: { kind: "downloading", fraction: 0 },
			error: null,
		});
		store.progress(older.id, 0.4);
		expect(rowOf(manager, older.id).state).toEqual({ kind: "downloading", fraction: 0.4 });
		store.finish(older.id);
		await retried;
		expect(rowOf(manager, older.id).state).toEqual({ kind: "ready" });
	});

	it("follows a download another page of this tab already started", async () => {
		const { store, manager } = setup();
		void store.download(older);
		store.progress(older.id, 0.2);
		await manager.load();
		expect(rowOf(manager, older.id).state).toEqual({ kind: "downloading", fraction: 0.2 });
		store.progress(older.id, 0.6);
		expect(rowOf(manager, older.id).state).toEqual({ kind: "downloading", fraction: 0.6 });
		store.finish(older.id);
		await flush();
		await flush();
		expect(rowOf(manager, older.id).state).toEqual({ kind: "ready" });
		expect(store.downloads).toBe(1);
	});

	it("shows the quota message on the row and points at deleting pins here", async () => {
		const { store, manager } = setup();
		await manager.load();
		const done = manager.download(older.id);
		store.fail(older.id, new PinStoreError("quota", older.id, "storage quota exceeded"));
		await done;
		expect(rowOf(manager, older.id)).toEqual({
			kind: "catalogue",
			pin: older,
			state: { kind: "absent" },
			error:
				"The browser's storage is full. Delete engine versions you no longer need on this page, then download again.",
		});
	});

	it("describes each download failure", () => {
		expect(pinErrorMessage(new PinStoreError("network", "x", "HTTP 404"))).toBe(
			"The download failed (x: HTTP 404). Try again.",
		);
		expect(pinErrorMessage(new PinStoreError("corrupt", "x", "sha256 mismatch"))).toBe(
			"The download did not match its checksum and was discarded. Try again.",
		);
		expect(pinErrorMessage(new Error("boom"))).toBe("boom");
	});
});

describe("stale pins", () => {
	it("marks a cached pin the catalogue no longer names as stale, and deletes it", async () => {
		const { store, manager } = setup({ abi: 1, pins: [newest] });
		store.cache(older.id, older.sha256, older.bytes);
		await manager.load();
		expect(rowOf(manager, older.id)).toEqual({
			kind: "stale",
			id: older.id,
			sha256: older.sha256,
			bytes: older.bytes,
			state: { kind: "stale" },
			error: null,
		});
		await manager.remove(older.id);
		expect(manager.state.rows.map((row) => row.kind)).toEqual(["catalogue"]);
		expect(manager.state.usage?.usedBytes).toBe(0);
	});
});

describe("the default pin", () => {
	it("falls back to the first catalogue pin when the stored id has been retired", async () => {
		const { storage, manager } = setup();
		storage.setItem(DEFAULT_PIN_STORAGE_KEY, "master-deadbee");
		await manager.load();
		expect(manager.state.defaultId).toBe(newest.id);
	});

	it("stores a new default and publishes it", async () => {
		const { storage, manager, states } = setup();
		await manager.load();
		manager.setDefault(older.id);
		expect(storage.items.get(DEFAULT_PIN_STORAGE_KEY)).toBe(older.id);
		expect(manager.state.defaultId).toBe(older.id);
		expect(states.at(-1)?.defaultId).toBe(older.id);
	});
});
