import { Metric, type MetricConfiguration } from "./metric.ts";
import { hashLabels, type LabelObject } from "./utils.ts";

export interface CounterConfiguration<L extends string>
	extends MetricConfiguration<Counter<L>, L> {}

export class Counter<L extends string = string> extends Metric<
	Counter<L>,
	L,
	{ value: number; labels: LabelObject<L> }
> {
	/**
	 * Increment counter
	 * @param value The value to increment with
	 */
	inc(labels: LabelObject<L>, value?: number): void;
	inc(value?: number): void;
	inc(param1?: LabelObject<L> | number, param2?: number) {
		const value = (typeof param1 === "object" ? param2 : param1) ?? 1;
		const labels = typeof param1 === "object" ? param1 : ({} as LabelObject<L>);

		if (value < 0) {
			throw new Error("counter cannot decrease");
		}

		const hashed = hashLabels(labels);
		const entry = this.values.get(hashed);

		if (entry) {
			entry.value += value;
		} else {
			this.values.set(hashed, { value, labels });
		}
	}

	/**
	 * Get sub-counter for a given set of labels
	 * @param labels Labels to affect when used
	 */
	withLabels(labels: LabelObject<L>) {
		return {
			inc: (value?: number) => {
				this.inc(labels, value);
			},
			reset: () => {
				this.values.delete(hashLabels(labels));
			},
		};
	}

	reset() {
		this.values.clear();
		if (!this.labelNames.length) {
			this.values.set(hashLabels({}), { labels: {}, value: 0 }); // todo: is this correct behavior?
		}
	}
}
