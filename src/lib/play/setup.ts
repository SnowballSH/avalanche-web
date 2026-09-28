import type { EngineLimitKind, TimeControl } from "./types";

const MS_PER_SECOND = 1_000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MIN_BASE_MINUTES = 0.25;
const MAX_BASE_MINUTES = 180;
const MAX_INCREMENT_SECONDS = 180;

export const DEFAULT_ELO = 1500;

export const CUSTOM_TIME_CONTROL = "custom";

const preset = (minutes: number, incrementSeconds: number): TimeControl => ({
	baseMs: minutes * MS_PER_MINUTE,
	incrementMs: incrementSeconds * MS_PER_SECOND,
});

export const TIME_CONTROL_PRESETS: readonly TimeControl[] = [
	preset(1, 0),
	preset(3, 2),
	preset(5, 3),
	preset(10, 5),
	preset(15, 10),
];

export const DEFAULT_TIME_CONTROL: TimeControl = preset(5, 3);

export const ENGINE_LIMIT_LABELS: Readonly<Record<EngineLimitKind, string>> = {
	movetime: "Move time (ms)",
	depth: "Depth",
	nodes: "Nodes",
};

export const ENGINE_LIMIT_MAX: Readonly<Record<EngineLimitKind, number>> = {
	movetime: 3_600_000,
	depth: 128,
	nodes: 10_000_000_000,
};

export const withinEngineLimit = (kind: EngineLimitKind, value: number): boolean =>
	Number.isSafeInteger(value) && value > 0 && value <= ENGINE_LIMIT_MAX[kind];

export const timeControlLabel = (control: TimeControl): string =>
	`${control.baseMs / MS_PER_MINUTE}+${control.incrementMs / MS_PER_SECOND}`;

export const customTimeControl = (
	minutes: number,
	incrementSeconds: number,
): TimeControl | null => {
	const validBase =
		Number.isFinite(minutes) && minutes >= MIN_BASE_MINUTES && minutes <= MAX_BASE_MINUTES;
	const validIncrement =
		Number.isInteger(incrementSeconds) &&
		incrementSeconds >= 0 &&
		incrementSeconds <= MAX_INCREMENT_SECONDS;
	if (!validBase || !validIncrement) return null;
	return {
		baseMs: Math.round(minutes * MS_PER_MINUTE),
		incrementMs: incrementSeconds * MS_PER_SECOND,
	};
};
