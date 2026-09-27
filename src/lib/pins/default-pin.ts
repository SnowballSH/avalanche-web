import type { GetDefaultPin, PinCatalogData, PinEntry, PinId, SetDefaultPin } from "./types";

export const DEFAULT_PIN_STORAGE_KEY = "avalanche.defaultPin";

export type PinChoiceStorage = Pick<Storage, "getItem" | "setItem">;

export interface DefaultPinChoice {
	readonly getDefaultPin: GetDefaultPin;
	readonly setDefaultPin: SetDefaultPin;
}

function readStoredId(storage: PinChoiceStorage | undefined): string | null {
	try {
		return storage?.getItem(DEFAULT_PIN_STORAGE_KEY) ?? null;
	} catch {
		return null;
	}
}

export function createDefaultPinChoice(storage: PinChoiceStorage | undefined): DefaultPinChoice {
	return {
		getDefaultPin(catalogue: PinCatalogData): PinEntry | null {
			const storedId = readStoredId(storage);
			return catalogue.pins.find((pin) => pin.id === storedId) ?? catalogue.pins[0] ?? null;
		},
		setDefaultPin(id: PinId): void {
			try {
				storage?.setItem(DEFAULT_PIN_STORAGE_KEY, id);
			} catch {
				return;
			}
		},
	};
}

function browserStorage(): PinChoiceStorage | undefined {
	try {
		return typeof window === "undefined" ? undefined : window.localStorage;
	} catch {
		return undefined;
	}
}

export const getDefaultPin: GetDefaultPin = (catalogue) =>
	createDefaultPinChoice(browserStorage()).getDefaultPin(catalogue);

export const setDefaultPin: SetDefaultPin = (id) =>
	createDefaultPinChoice(browserStorage()).setDefaultPin(id);
