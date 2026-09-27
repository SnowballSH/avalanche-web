export type LinePredicate = (line: string) => boolean;

export class EngineTap {
	readonly lines: string[] = [];
	readonly #deliver: (line: string) => void;
	readonly #arrivalListeners = new Set<() => void>();
	#delivered = 0;
	#held = false;

	constructor(deliver: (line: string) => void) {
		this.#deliver = deliver;
	}

	get delivered(): number {
		return this.#delivered;
	}

	receive(line: string): void {
		this.lines.push(line);
		if (!this.#held) this.#flush();
		for (const listener of this.#arrivalListeners) listener();
	}

	hold(): void {
		this.#held = true;
	}

	release(): void {
		this.#held = false;
		this.#flush();
	}

	arrival(predicate: LinePredicate, from: number, timeoutMs: number): Promise<void> {
		const arrived = () => this.lines.slice(from).some(predicate);
		if (arrived()) return Promise.resolve();
		const { promise, resolve, reject } = Promise.withResolvers<void>();
		const timer = setTimeout(() => {
			this.#arrivalListeners.delete(listener);
			reject(new Error(`No matching engine line arrived within ${String(timeoutMs)} ms`));
		}, timeoutMs);
		const listener = () => {
			if (!arrived()) return;
			clearTimeout(timer);
			this.#arrivalListeners.delete(listener);
			resolve();
		};
		this.#arrivalListeners.add(listener);
		return promise;
	}

	#flush(): void {
		while (this.#delivered < this.lines.length) {
			const line = this.lines[this.#delivered++];
			if (line !== undefined) this.#deliver(line);
		}
	}
}
