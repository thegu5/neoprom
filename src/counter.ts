import { Metric, type MetricConfiguration } from "./metric.ts";
import { hashLabels, type LabelObject, parseMetricParams } from "./utils.ts";

export class Counter<L extends string = string> extends Metric<
	Counter<L>,
	L,
	{ value: number; labels: LabelObject<L> }
> {
	constructor(options: MetricConfiguration<Counter<L>, L>) {
		// normalize name so it's the same between the prometheus text format and openmetrics
		if (!options.name.endsWith("_total")) {
			options.name += "_total";
		}
		super(options);
	}
	/**
	 * Increment counter for labels
	 * @param labels An object containing label names and their values
	 * @param value The amount to increment with
	 */
	inc(labels: LabelObject<L>, value?: number): void;
	/**
	 * Increment counter
	 * @param value The value to increment with (default: 1)
	 */
	inc(value?: number): void;
	inc(param1?: LabelObject<L> | number, param2?: number) {
		const [value, labels] = parseMetricParams(param1, param2, 1);

		if (value < 0) {
			throw new Error("counter cannot decrease");
		}

		const hashed = hashLabels(labels);
		const entry = this.valueMap.get(hashed);

		if (entry) {
			entry.value += value;
		} else {
			this.valueMap.set(hashed, { value, labels });
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
				this.valueMap.delete(hashLabels(labels));
			},
		};
	}

	reset() {
		this.valueMap.clear();
		if (!this.labelNames.length) {
			this.valueMap.set(hashLabels({}), { labels: {}, value: 0 });
		}
	}
}
