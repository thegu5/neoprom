import {
	createHook,
	hashLabels,
	type LabelObject,
	parseMetricParams,
	startTimer,
} from "../utils.ts";
import { Metric } from "./metric.ts";

export class Gauge<L extends string = string> extends Metric<
	Gauge<L>,
	L,
	{ value: number; labels: LabelObject<L> }
> {
	/**
	 * Increment gauge for given labels
	 * @param labels Object with label keys and their values
	 * @param value The value to increment with
	 */
	inc(labels: LabelObject<L>, value?: number): void;
	/**
	 * Increment gauge
	 * @param value The value to increment with
	 */
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
	 * Decrement gauge for given labels
	 * @param labels Object with label keys and their values
	 * @param value The value to decrement with
	 */
	dec(labels: LabelObject<L>, value?: number): void;
	/**
	 * Decrement gauge
	 * @param value The value to decrement with
	 */
	dec(value?: number): void;
	dec(param1?: LabelObject<L> | number, param2?: number) {
		const [value, labels] = parseMetricParams(param1, param2, 1);

		return this.inc(labels, -value);
	}

	/**
	 * Set gauge for given labels
	 * @param labels Object with label keys and their values
	 * @param value The value to set
	 */
	set(labels: LabelObject<L>, value?: number): void;
	/**
	 * Set gauge
	 * @param value The value to set
	 */
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

	/**
	 * Set gauge value to current epoch time in seconds
	 * @param labels Object with label keys and values
	 */
	setToCurrentTime(labels: LabelObject<L> = {}) {
		this.set(labels, Date.now() / 1000);
	}

	/**
	 * Start timer to log a duration in seconds
	 * @param startLabels Labels to record the time to
	 */
	startTimer(startLabels: LabelObject<L> = {}) {
		return startTimer(this.set.bind(this), startLabels);
	}

	/**
	 * Sets the gauge to how long a function takes to execute, in seconds.
	 * Can be used as a function wrapper, or as a class method decorator.
	 * @example
	 * ```typescript
	 * let result = gauge.time(doComputation, labels)(...args);
	 * class Foo {
	 * 	⁣@gauge.time(labels)
	 * 	doComputation() { }
	 * }
	 * ```
	 */
	time = createHook((labels) => this.startTimer(labels));

	/**
	 * Increment the gauge when a code block is entered, and decrement it when exited.
	 * Can be used as a function wrapper, or as a class method decorator.
	 * @example
	 * ```typescript
	 * let result = gauge.trackInProgress(someDatabaseCall, labels)(...args);
	 * class Foo {
	 * 	⁣@gauge.trackInProgress(labels)
	 * 	someDatabaseCall() { }
	 * }
	 * ```
	 */
	trackInProgress = createHook(
		(labels: LabelObject<L> = {}) => {
			this.inc(labels, 1);
			return () => {
				this.dec(labels, 1);
			};
		},
		{ includeExceptions: true },
	);

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
			set: (value?: number) => {
				this.set(labels, value);
			},
			startTimer: () => {
				return this.startTimer(labels);
			},
			time: createHook(() => this.startTimer(labels)),
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
			this.valueMap.set(hashLabels({}), { labels: {}, value: 0 });
		}
	}
}
