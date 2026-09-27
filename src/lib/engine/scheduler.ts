import type {
	EngineLease,
	EngineScheduler,
	LeaseConflictError as LeaseConflictErrorContract,
	LeaseOwner,
	LeaseState,
	Unsubscribe,
} from "./types";

export class LeaseConflictError extends Error implements LeaseConflictErrorContract {
	override readonly name = "LeaseConflictError";
	readonly owner: LeaseOwner;

	constructor(owner: LeaseOwner) {
		super(`The ${owner} owner already holds an engine lease`);
		this.owner = owner;
	}
}

class Lease implements EngineLease {
	readonly owner: LeaseOwner;
	#state: LeaseState;
	readonly #listeners = new Set<(state: LeaseState) => void>();

	constructor(owner: LeaseOwner, state: LeaseState) {
		this.owner = owner;
		this.#state = state;
	}

	get state(): LeaseState {
		return this.#state;
	}

	transition(state: LeaseState): void {
		if (this.#state === state) return;
		this.#state = state;
		for (const listener of this.#listeners) listener(state);
	}

	onStateChange(listener: (state: LeaseState) => void): Unsubscribe {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}
}

class PriorityScheduler implements EngineScheduler {
	readonly #leases = new Map<LeaseOwner, Lease>();

	acquire(owner: LeaseOwner): EngineLease {
		if (this.#leases.has(owner)) throw new LeaseConflictError(owner);
		const playActive = this.#leases.get("play")?.state === "active";
		const lease = new Lease(owner, owner === "analysis" && playActive ? "suspended" : "active");
		this.#leases.set(owner, lease);
		if (owner === "play") this.#leases.get("analysis")?.transition("suspended");
		return lease;
	}

	release(lease: EngineLease): void {
		const held = this.#leases.get(lease.owner);
		if (held !== lease) return;
		this.#leases.delete(lease.owner);
		held.transition("released");
		if (lease.owner === "play") this.#leases.get("analysis")?.transition("active");
	}
}

export function createScheduler(): EngineScheduler {
	return new PriorityScheduler();
}
