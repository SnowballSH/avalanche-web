import type { AbiVersion, PinCatalogData, PinEntry } from "./types";

export type PinSource = Omit<PinEntry, "sha256" | "bytes">;

export interface PinCatalogueSource {
	readonly abi: AbiVersion;
	readonly pins: readonly PinSource[];
}

export interface PinMeasurement {
	readonly sha256: string;
	readonly bytes: number;
}

export type MeasurePin = (pin: PinSource) => PinMeasurement;

export class PinCatalogueError extends Error {
	override readonly name = "PinCatalogueError";
}

const PIN_ID = /^[a-z0-9][a-z0-9.-]*$/;
const COMMIT = /^[0-9a-f]{40}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function fail(message: string): never {
	throw new PinCatalogueError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(pin: Record<string, unknown>, field: keyof PinSource, at: string): string {
	const value = pin[field];
	if (typeof value !== "string" || value.length === 0) {
		fail(`${at}: ${field} must be a non-empty string`);
	}
	return value;
}

function parsePin(value: unknown, index: number): PinSource {
	const at = `pins[${index}]`;
	if (!isRecord(value)) fail(`${at}: must be an object`);
	const id = requireString(value, "id", at);
	if (!PIN_ID.test(id)) fail(`${at}: id "${id}" must match ${PIN_ID}`);
	const commit = requireString(value, "commit", at);
	if (!COMMIT.test(commit)) fail(`${at}: commit "${commit}" must be 40 lowercase hex characters`);
	const label = requireString(value, "label", at);
	const date = requireString(value, "date", at);
	if (!DATE.test(date)) fail(`${at}: date "${date}" must be YYYY-MM-DD`);
	return { id, commit, label, date };
}

function rejectDuplicates(pins: readonly PinSource[], field: "id" | "commit"): void {
	const seen = new Set<string>();
	for (const pin of pins) {
		if (seen.has(pin[field])) fail(`duplicate ${field} "${pin[field]}"`);
		seen.add(pin[field]);
	}
}

export function parsePinCatalogueSource(data: unknown): PinCatalogueSource {
	if (!isRecord(data)) fail("catalogue must be an object");
	if (data.abi !== 1) fail(`abi must be 1, found ${JSON.stringify(data.abi)}`);
	if (!Array.isArray(data.pins) || data.pins.length === 0) {
		fail("pins must be a non-empty array");
	}
	const pins = data.pins.map(parsePin);
	rejectDuplicates(pins, "id");
	rejectDuplicates(pins, "commit");
	return { abi: 1, pins };
}

export function withMeasurements(source: PinCatalogueSource, measure: MeasurePin): PinCatalogData {
	return {
		abi: source.abi,
		pins: source.pins.map((pin) => ({ ...pin, ...measure(pin) })),
	};
}
