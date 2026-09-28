import { describe, expect, it } from "vitest";
import {
	ANALYSIS_HANDOFF_KEY,
	type HandoffStorage,
	handOffToAnalysis,
	takeAnalysisHandoff,
} from "../../src/lib/shared/analysis-handoff";

const memoryStorage = (): HandoffStorage & { readonly items: Map<string, string> } => {
	const items = new Map<string, string>();
	return {
		items,
		getItem: (key) => items.get(key) ?? null,
		setItem: (key, value) => {
			items.set(key, value);
		},
		removeItem: (key) => {
			items.delete(key);
		},
	};
};

const throwing: HandoffStorage = {
	getItem: () => {
		throw new Error("SecurityError");
	},
	setItem: () => {
		throw new Error("QuotaExceededError");
	},
	removeItem: () => {
		throw new Error("SecurityError");
	},
};

describe("the analysis handoff", () => {
	it("hands a PGN over once", () => {
		const storage = memoryStorage();
		expect(handOffToAnalysis("1. e4 *", storage)).toBe(true);
		expect(storage.items.get(ANALYSIS_HANDOFF_KEY)).toBe("1. e4 *");
		expect(takeAnalysisHandoff(storage)).toBe("1. e4 *");
		expect(takeAnalysisHandoff(storage)).toBeNull();
	});

	it("degrades when storage throws or is absent", () => {
		expect(handOffToAnalysis("1. e4 *", throwing)).toBe(false);
		expect(takeAnalysisHandoff(throwing)).toBeNull();
		expect(handOffToAnalysis("1. e4 *", undefined)).toBe(false);
		expect(takeAnalysisHandoff(undefined)).toBeNull();
	});
});
