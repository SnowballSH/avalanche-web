import type { PinStore } from "./types";

export const askToPersist = (store: Pick<PinStore, "requestPersistence">): void => {
	void store.requestPersistence().catch(() => false);
};
