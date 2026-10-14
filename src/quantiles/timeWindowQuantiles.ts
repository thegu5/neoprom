import { TDigest } from "./tdigest.ts";

/**
 * Quantiles over a sliding window of time.
 *
 * The window is split into `ageBuckets` slots that each cover `maxAgeSeconds / ageBuckets`.
 * Observations go into the current slot only. When a slot ages out it is cleared and reused,
 * so at any time the window covers between `(ageBuckets - 1) / ageBuckets * maxAgeSeconds`
 * and `maxAgeSeconds` of data. Quantiles are read by merging the slots.
 *
 * Rotation happens lazily when observing or reading, so no timers are needed.
 */
export class TimeWindowQuantiles {
	readonly #slots: TDigest[];
	readonly #slotMs: number;
	#head = 0;
	#slotStart: number;

	constructor(maxAgeSeconds: number, ageBuckets: number) {
		this.#slots = Array.from({ length: ageBuckets }, () => new TDigest());
		this.#slotMs = (maxAgeSeconds * 1000) / ageBuckets;
		this.#slotStart = Date.now();
	}

	/** Number of observations currently in the window */
	get count() {
		this.#rotate();
		let count = 0;
		for (const slot of this.#slots) count += slot.count;
		return count;
	}

	observe(value: number) {
		this.#rotate();
		this.#slots[this.#head].observe(value);
	}

	/**
	 * Estimate the values at the given quantiles over the window
	 * @returns One value per quantile, `NaN` if the window is empty
	 */
	quantiles(quantiles: readonly number[]) {
		this.#rotate();

		const merged = new TDigest();
		merged.merge(...this.#slots);
		return quantiles.map((q) => merged.quantile(q));
	}

	#rotate() {
		const now = Date.now();
		if (now < this.#slotStart) {
			// the clock went backwards
			this.#slotStart = now;
			return;
		}

		let steps = Math.floor((now - this.#slotStart) / this.#slotMs);
		if (steps <= 0) return;
		this.#slotStart += steps * this.#slotMs;

		// if we were idle for longer than the whole window, every slot has expired
		steps = Math.min(steps, this.#slots.length);
		for (let i = 0; i < steps; i++) {
			this.#head = (this.#head + 1) % this.#slots.length;
			this.#slots[this.#head].clear();
		}
	}
}
