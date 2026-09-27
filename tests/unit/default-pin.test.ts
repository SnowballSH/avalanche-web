import { describe, expect, it } from "vitest";
import {
	createDefaultPinChoice,
	DEFAULT_PIN_STORAGE_KEY,
	getDefaultPin,
	setDefaultPin,
} from "../../src/lib/pins/default-pin";
import type {
	GetDefaultPin,
	PinCatalogData,
	PinEntry,
	SetDefaultPin,
} from "../../src/lib/pins/types";

function pin(id: string): PinEntry {
	return {
		id,
		commit: id.padEnd(40, "0"),
		label: id,
		date: "2026-09-27",
		sha256: "ab".repeat(32),
		bytes: 1,
	};
}

const older = pin("master-910711f");
const newest = pin("master-8c66796");
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

class ThrowingStorage {
	getItem(): string | null {
		throw new DOMException("access denied", "SecurityError");
	}
	setItem(): void {
		throw new DOMException("quota", "QuotaExceededError");
	}
}

describe("default pin choice", () => {
	it("falls back to the first catalogue pin when nothing is stored", () => {
		const { getDefaultPin } = createDefaultPinChoice(new MemoryStorage());
		expect(getDefaultPin(catalogue)).toBe(newest);
	});

	it("returns the stored pin after setDefaultPin", () => {
		const storage = new MemoryStorage();
		const { getDefaultPin, setDefaultPin } = createDefaultPinChoice(storage);
		setDefaultPin(older.id);
		expect(storage.items.get(DEFAULT_PIN_STORAGE_KEY)).toBe(older.id);
		expect(getDefaultPin(catalogue)).toBe(older);
	});

	it("falls back to the first catalogue pin when the stored id is retired", () => {
		const storage = new MemoryStorage();
		storage.setItem(DEFAULT_PIN_STORAGE_KEY, "master-deadbee");
		const { getDefaultPin } = createDefaultPinChoice(storage);
		expect(getDefaultPin(catalogue)).toBe(newest);
	});

	it("returns null only for an empty catalogue", () => {
		const { getDefaultPin } = createDefaultPinChoice(new MemoryStorage());
		expect(getDefaultPin({ abi: 1, pins: [] })).toBeNull();
	});

	it("tolerates storage that throws on read and write", () => {
		const { getDefaultPin, setDefaultPin } = createDefaultPinChoice(new ThrowingStorage());
		expect(() => setDefaultPin(older.id)).not.toThrow();
		expect(getDefaultPin(catalogue)).toBe(newest);
	});

	it("tolerates a missing storage", () => {
		const { getDefaultPin, setDefaultPin } = createDefaultPinChoice(undefined);
		expect(() => setDefaultPin(older.id)).not.toThrow();
		expect(getDefaultPin(catalogue)).toBe(newest);
	});

	it("exports browser-bound functions matching the contract types", () => {
		const get: GetDefaultPin = getDefaultPin;
		const set: SetDefaultPin = setDefaultPin;
		expect(() => set(older.id)).not.toThrow();
		expect(get(catalogue)).toBe(newest);
	});
});
