import { Metric, type MetricConfiguration } from "./metric.ts";
import { hashLabels } from "./utils.ts";

export interface CounterConfiguration<L extends string>
	extends MetricConfiguration<Counter<L>, L> {}

export class Counter<L extends string> extends Metric<Counter<L>, L> {
	#values = new Map<
		string,
		{ value: number; labels: Partial<Record<L, string>> }
	>();

	/**
	 * Increment counter
	 * @param value The value to increment with
	 */
	inc(labels: Partial<Record<L, string>>, value?: number): void;
	inc(value?: number): void;
	inc(param1?: Partial<Record<L, string>> | number, param2?: number) {
		const value = (typeof param1 === "object" ? param2 : param1) ?? 1;
		const labels =
			typeof param1 === "object" ? param1 : ({} as Partial<Record<L, string>>);

		if (value < 0) {
			throw new Error("counter cannot decrease");
		}

		const hashed = hashLabels(labels);
		const entry = this.#values.get(hashed);

		if (entry) {
			entry.value += value;
		} else {
			this.#values.set(hashed, { value, labels });
		}
	}

	/**
	 * Get sub-counter for a given set of labels
	 * @param labels Labels to affect when used
	 */
	withLabels(labels: Partial<Record<L, string>>) {
		return {
			inc: (value?: number) => {
				this.inc(labels, value);
			},
			reset: () => {
				this.#values.delete(hashLabels(labels));
			},
		};
	}

	reset() {
		this.#values.clear();
		if (!this.labelNames.length) {
		this.#values.set(hashLabels({}), { labels: {}, value: 0 }); // todo: is this correct behavior?
		}
	}
}
