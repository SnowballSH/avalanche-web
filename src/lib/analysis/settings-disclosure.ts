export const SETTINGS_OPEN_STORAGE_KEY = "avalanche-analysis-settings-open";

export type DisclosureStorage = Pick<Storage, "getItem" | "setItem">;

export interface DisclosureMemory {
	readonly isOpen: () => boolean;
	readonly remember: (open: boolean) => void;
}

export const createDisclosureMemory = (
	storage: DisclosureStorage | undefined,
	key: string = SETTINGS_OPEN_STORAGE_KEY,
): DisclosureMemory => ({
	isOpen() {
		try {
			return storage?.getItem(key) === "true";
		} catch {
			return false;
		}
	},
	remember(open) {
		try {
			storage?.setItem(key, String(open));
		} catch {
			return;
		}
	},
});

export const browserDisclosureMemory = (key?: string): DisclosureMemory => {
	try {
		return createDisclosureMemory(
			typeof window === "undefined" ? undefined : window.localStorage,
			key,
		);
	} catch {
		return createDisclosureMemory(undefined, key);
	}
};
