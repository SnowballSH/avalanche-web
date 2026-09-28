import type { PinState, StorageUsage } from "./types";

export const AVALANCHE_REPOSITORY = "https://github.com/SnowballSH/Avalanche";

const SHORT_COMMIT_LENGTH = 7;

const BYTE_UNITS = ["B", "kB", "MB", "GB"] as const;

const BYTE_UNIT_STEP = 1000;

export const shortCommit = (commit: string): string => commit.slice(0, SHORT_COMMIT_LENGTH);

export const pinCommitUrl = (commit: string): string => `${AVALANCHE_REPOSITORY}/commit/${commit}`;

export const formatBytes = (bytes: number): string => {
	let value = bytes;
	let unit = 0;
	while (value >= BYTE_UNIT_STEP && unit < BYTE_UNITS.length - 1) {
		value /= BYTE_UNIT_STEP;
		unit += 1;
	}
	return unit === 0 ? `${bytes} B` : `${value.toFixed(1)} ${BYTE_UNITS[unit]}`;
};

export const formatUsage = ({ usedBytes, quotaBytes }: StorageUsage): string => {
	const used = `Stored in this browser: ${formatBytes(usedBytes)}`;
	return quotaBytes === null
		? used
		: `${used} of ${formatBytes(quotaBytes)} available to this site`;
};

export const pinStateLabel = (state: PinState): string => {
	switch (state.kind) {
		case "absent":
			return "Not downloaded";
		case "downloading":
			return `Downloading ${Math.floor(state.fraction * 100)}%`;
		case "ready":
			return "Ready";
		case "corrupt":
			return "Corrupt";
		case "stale":
			return "Stale";
	}
};
