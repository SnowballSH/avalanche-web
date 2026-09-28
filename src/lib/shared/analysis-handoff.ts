export const ANALYSIS_HANDOFF_KEY = "avalanche-analysis-handoff";

export type HandoffStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const sessionStore = (): HandoffStorage | undefined => {
	try {
		return typeof window === "undefined" ? undefined : window.sessionStorage;
	} catch {
		return undefined;
	}
};

export const handOffToAnalysis = (pgn: string, storage = sessionStore()): boolean => {
	try {
		storage?.setItem(ANALYSIS_HANDOFF_KEY, pgn);
		return storage !== undefined;
	} catch {
		return false;
	}
};

export const takeAnalysisHandoff = (storage = sessionStore()): string | null => {
	try {
		const pgn = storage?.getItem(ANALYSIS_HANDOFF_KEY) ?? null;
		storage?.removeItem(ANALYSIS_HANDOFF_KEY);
		return pgn;
	} catch {
		return null;
	}
};
