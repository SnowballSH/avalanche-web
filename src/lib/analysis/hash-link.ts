import type { Fen } from "$lib/engine/types";

export const ANALYSIS_PATH = "/analysis";

export const fenHash = (fen: Fen): string => `#fen=${fen.trim().replaceAll(" ", "_")}`;

export const analysisLink = (fen: Fen): string => `${ANALYSIS_PATH}${fenHash(fen)}`;

export const fenFromHash = (hash: string): Fen | null => {
	const value = new URLSearchParams(hash.replace(/^#/, "")).get("fen");
	return value === null ? null : value.replaceAll("_", " ");
};
