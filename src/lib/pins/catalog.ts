import {
	PinCatalogueError,
	type PinMeasurement,
	parsePinCatalogueSource,
} from "./catalogue-source";
import type { PinCatalog, PinCatalogData } from "./types";

export const PIN_CATALOGUE_URL = "/engines/pins.json";

const SHA256_HEX = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMeasurement(value: unknown, index: number): PinMeasurement {
	const at = `pins[${index}]`;
	if (!isRecord(value)) throw new PinCatalogueError(`${at}: must be an object`);
	const { sha256, bytes } = value;
	if (typeof sha256 !== "string" || !SHA256_HEX.test(sha256)) {
		throw new PinCatalogueError(`${at}: sha256 must be 64 lowercase hex characters`);
	}
	if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes <= 0) {
		throw new PinCatalogueError(`${at}: bytes must be a positive integer`);
	}
	return { sha256, bytes };
}

export function parseServedPinCatalogue(data: unknown): PinCatalogData {
	const source = parsePinCatalogueSource(data);
	const rawPins = (data as { pins: readonly unknown[] }).pins;
	return {
		abi: source.abi,
		pins: source.pins.map((pin, index) => ({ ...pin, ...parseMeasurement(rawPins[index], index) })),
	};
}

export function createPinCatalog(fetchFn: typeof fetch): PinCatalog {
	return {
		async load(): Promise<PinCatalogData> {
			const response = await fetchFn(PIN_CATALOGUE_URL, { cache: "no-cache" });
			if (!response.ok) {
				throw new PinCatalogueError(`${PIN_CATALOGUE_URL}: HTTP ${response.status}`);
			}
			let data: unknown;
			try {
				data = await response.json();
			} catch (cause) {
				throw new PinCatalogueError(`${PIN_CATALOGUE_URL}: body is not JSON`, { cause });
			}
			return parseServedPinCatalogue(data);
		},
	};
}
