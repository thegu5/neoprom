import { Metric } from "./metric.ts";
import {
	createMeasure,
	hashLabels,
	type LabelObject,
	parseMetricParams,
	startTimer,
} from "./utils.ts";

export class Gauge<L extends string = string> extends Metric<
	Gauge<L>,
	L,
	{ value: number; labels: LabelObject<L> }
> {
	/**
	 * Increment gauge
	 * @param value The value to increment with
	 */
	inc(labels: LabelObject<L>, value?: number): void;
	inc(value?: number): void;
	inc(param1?: LabelObject<L> | number, param2?: number) {
		const [value, labels] = parseMetricParams(param1, param2, 1);

		const hashed = hashLabels(labels);
		const entry = this.valueMap.get(hashed);

		if (entry) {
			entry.value += value;
		} else {
			this.valueMap.set(hashed, { value, labels });
		}
	}

	/**
	 * Decrement gauge
	 * @param value The value to decrement with
	 */
	dec(labels: LabelObject<L>, value?: number): void;
	dec(value?: number): void;
	dec(param1?: LabelObject<L> | number, param2?: number) {
		const [value, labels] = parseMetricParams(param1, param2, 1);

		return this.inc(labels, -value);
	}

	/**
	 * Set gauge
	 * @param value The value to increment with
	 */
	set(labels: LabelObject<L>, value?: number): void;
	set(value?: number): void;
	set(param1?: LabelObject<L> | number, param2?: number) {
		const [value, labels] = parseMetricParams(param1, param2, 1);

		const hashed = hashLabels(labels);
		const entry = this.valueMap.get(hashed);

		if (entry) {
			entry.value = value;
		} else {
			this.valueMap.set(hashed, { value, labels });
		}
	}

	setToCurrentTime(): void;
	setToCurrentTime(labels: LabelObject<L>): void;
	setToCurrentTime(labels?: LabelObject<L>) {
		const now = Date.now() / 1000;
		if (labels) {
			this.set(labels, now);
		} else {
			this.set(now);
		}
	}

	/**
	 * Start timer to log a duration
	 * @param startLabels Labels to record the time to
	 */
	startTimer(startLabels: LabelObject<L> = {}) {
		return startTimer(this.set, startLabels);
	}

	// TODO: @overload tag
	/**
	 * Sets the gauge to how long a function takes to execute. It can be used in two ways:
	 * @example
	 * ```typescript
	 * let result = gauge.measure(doComputation, labels)(...args);
	 * class Foo {
	 * 	⁣@gauge.measure(labels)
	 * 	doComputation() { }
	 * }
	 * ```
	 */
	measure = createMeasure(this);

	/**
	 * Get sub-gauge for a given set of labels
	 * @param labels Labels to affect when used
	 */
	withLabels(labels: LabelObject<L>) {
		return {
			inc: (value?: number) => {
				this.inc(labels, value);
			},
			dec: (value?: number) => {
				this.dec(labels, value);
			},
			reset: () => {
				this.valueMap.delete(hashLabels(labels));
			},
		};
	}

	/**
	 * Reset the gauge
	 */
	reset() {
		this.valueMap.clear();
		if (!this.labelNames.length) {
			this.valueMap.set(hashLabels({}), { labels: {}, value: 0 }); // todo: is this correct behavior?
		}
	}
}
