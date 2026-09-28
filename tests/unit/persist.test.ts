import { describe, expect, it } from "vitest";
import { createPlayStore, PLAY_STORAGE_KEY, type PlayStorage } from "../../src/lib/play/persist";
import type { SavedGame } from "../../src/lib/play/types";

const memoryStorage = (): PlayStorage & { readonly items: Map<string, string> } => {
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

const throwingStorage: PlayStorage = {
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

const game: SavedGame = {
	version: 1,
	setup: {
		settings: {
			side: "random",
			start: { kind: "frc", scharnagl: 42 },
			pinId: "master-9b7ee6f",
			strength: { kind: "elo", elo: 1800 },
			timeControl: { baseMs: 180_000, incrementMs: 2_000 },
			engineLimit: { kind: "nodes", value: 5_000 },
			hashMb: 64,
			threads: null,
			ponder: true,
		},
		userColor: "black",
		startedAt: "2026-09-27T12:00:00.000Z",
	},
	moves: ["e2e4", "e7e5"],
	clock: { whiteMs: 170_000, blackMs: 175_500, running: "white" },
	engineScores: [
		{ kind: "cp", value: 31 },
		{ kind: "mate", value: 4, bound: "lower" },
	],
	result: null,
};

describe("createPlayStore", () => {
	it("round-trips a saved game under the versioned key", () => {
		const storage = memoryStorage();
		const store = createPlayStore(storage);
		store.save(game);
		expect([...storage.items.keys()]).toEqual([PLAY_STORAGE_KEY]);
		expect(PLAY_STORAGE_KEY).toBe("avalanche-play-v1");
		expect(createPlayStore(storage).load()).toEqual(game);
	});

	it("keeps a finished game's result", () => {
		const storage = memoryStorage();
		const finished: SavedGame = {
			...game,
			clock: { ...game.clock, running: null },
			result: { winner: "white", reason: "resign" },
		};
		createPlayStore(storage).save(finished);
		expect(createPlayStore(storage).load()).toEqual(finished);
	});

	it.each([
		["corrupt JSON", "{not json"],
		["an old version", JSON.stringify({ ...game, version: 0 })],
		["a newer version", JSON.stringify({ ...game, version: 2 })],
		["a move that is not a string", JSON.stringify({ ...game, moves: ["e2e4", 7] })],
		["a negative clock", JSON.stringify({ ...game, clock: { ...game.clock, whiteMs: -1 } })],
		[
			"an unknown result reason",
			JSON.stringify({ ...game, result: { winner: "white", reason: "x" } }),
		],
		[
			"an FRC number out of range",
			JSON.stringify({
				...game,
				setup: {
					...game.setup,
					settings: { ...game.setup.settings, start: { kind: "frc", scharnagl: 960 } },
				},
			}),
		],
		["a JSON null", "null"],
		[
			"a start time that is not an ISO timestamp",
			JSON.stringify({ ...game, setup: { ...game.setup, startedAt: "yesterday" } }),
		],
		[
			"a nodes limit beyond the bound",
			JSON.stringify({
				...game,
				setup: {
					...game.setup,
					settings: { ...game.setup.settings, engineLimit: { kind: "nodes", value: 1e13 } },
				},
			}),
		],
		[
			"a depth limit beyond the bound",
			JSON.stringify({
				...game,
				setup: {
					...game.setup,
					settings: { ...game.setup.settings, engineLimit: { kind: "depth", value: 500 } },
				},
			}),
		],
		["moves that do not replay", JSON.stringify({ ...game, moves: ["e2e4", "e2e4"] })],
		[
			"a running clock for the side not to move",
			JSON.stringify({ ...game, clock: { ...game.clock, running: "black" } }),
		],
		[
			"a running clock after the result",
			JSON.stringify({ ...game, result: { winner: "white", reason: "resign" } }),
		],
	])("discards %s", (_label, stored) => {
		const storage = memoryStorage();
		storage.setItem(PLAY_STORAGE_KEY, stored);
		expect(createPlayStore(storage).load()).toBeNull();
		expect(storage.items.has(PLAY_STORAGE_KEY)).toBe(false);
	});

	it("clamps a restored Hash to this device's choices", () => {
		const storage = memoryStorage();
		const settings = (hashMb: number) => ({
			...game,
			setup: { ...game.setup, settings: { ...game.setup.settings, hashMb } },
		});
		const store = createPlayStore(storage, { hashChoices: [16, 32, 64] });
		for (const [saved, restored] of [
			[1024, 64],
			[48, 32],
			[8, 16],
			[32, 32],
		] as const) {
			storage.setItem(PLAY_STORAGE_KEY, JSON.stringify(settings(saved)));
			expect(store.load()?.setup.settings.hashMb).toBe(restored);
		}
	});

	it("clears the saved game", () => {
		const storage = memoryStorage();
		const store = createPlayStore(storage);
		store.save(game);
		store.clear();
		expect(store.load()).toBeNull();
	});

	it("degrades to no saved game when storage throws or is absent", () => {
		for (const store of [createPlayStore(throwingStorage), createPlayStore(undefined)]) {
			expect(() => store.save(game)).not.toThrow();
			expect(store.load()).toBeNull();
			expect(() => store.clear()).not.toThrow();
		}
	});
});
