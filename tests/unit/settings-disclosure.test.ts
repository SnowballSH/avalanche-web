import { describe, expect, it } from "vitest";
import {
	createDisclosureMemory,
	SETTINGS_OPEN_STORAGE_KEY,
} from "../../src/lib/analysis/settings-disclosure";

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

describe("settings disclosure memory", () => {
	it("is closed when nothing is stored", () => {
		expect(createDisclosureMemory(new MemoryStorage()).isOpen()).toBe(false);
	});

	it("remembers the open state under its key", () => {
		const storage = new MemoryStorage();
		const memory = createDisclosureMemory(storage);
		memory.remember(true);
		expect(storage.items.get(SETTINGS_OPEN_STORAGE_KEY)).toBe("true");
		expect(memory.isOpen()).toBe(true);
		memory.remember(false);
		expect(memory.isOpen()).toBe(false);
	});

	it("treats an unexpected stored value as closed", () => {
		const storage = new MemoryStorage();
		storage.setItem(SETTINGS_OPEN_STORAGE_KEY, "yes");
		expect(createDisclosureMemory(storage).isOpen()).toBe(false);
	});

	it("degrades to closed and silent when storage throws or is absent", () => {
		const throwing = createDisclosureMemory(new ThrowingStorage());
		expect(throwing.isOpen()).toBe(false);
		expect(() => throwing.remember(true)).not.toThrow();
		const absent = createDisclosureMemory(undefined);
		expect(absent.isOpen()).toBe(false);
		expect(() => absent.remember(true)).not.toThrow();
	});
});
