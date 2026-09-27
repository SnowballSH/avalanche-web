import { describe, expect, it } from "vitest";
import { hashCapMb, hashChoices } from "../../src/lib/engine/memory";

const isPowerOfTwo = (value: number): boolean => value > 0 && (value & (value - 1)) === 0;

describe("hashCapMb", () => {
	it("caps at deviceMemory times 128 MB", () => {
		expect(hashCapMb(4)).toBe(512);
	});

	it("never exceeds 1024 MB", () => {
		expect(hashCapMb(16)).toBe(1024);
		expect(hashCapMb(8)).toBe(1024);
	});

	it("falls back to 256 MB without deviceMemory", () => {
		expect(hashCapMb(undefined)).toBe(256);
		expect(hashCapMb()).toBe(256);
	});

	it("rounds an odd deviceMemory down to a power of two", () => {
		expect(hashCapMb(3)).toBe(256);
	});
});

describe("hashChoices", () => {
	it("offers only powers of two up to the cap", () => {
		for (const deviceMemory of [undefined, 0.25, 0.5, 1, 2, 4, 8, 16]) {
			const choices = hashChoices(deviceMemory);
			expect(choices.length).toBeGreaterThan(0);
			expect(choices.every(isPowerOfTwo)).toBe(true);
			expect(choices.at(-1)).toBe(hashCapMb(deviceMemory));
		}
	});

	it("lists the choices for a 4 GB device", () => {
		expect(hashChoices(4)).toEqual([16, 32, 64, 128, 256, 512]);
	});

	it("lists the choices for a 16 GB device", () => {
		expect(hashChoices(16)).toEqual([16, 32, 64, 128, 256, 512, 1024]);
	});

	it("lists the fallback choices", () => {
		expect(hashChoices()).toEqual([16, 32, 64, 128, 256]);
	});
});
