import {
	createHook,
	hashLabels,
	type LabelObject,
	parseMetricParams,
	startTimer,
} from "../utils.ts";
import { Metric, type MetricConfiguration } from "./metric.ts";

export interface HistogramConfiguration<L extends string, B extends number>
	extends MetricConfiguration<Histogram<L, B>, L> {
	buckets?: readonly B[];
}

export class Histogram<
	L extends string = string,
	B extends number = number,
> extends Metric<
	Histogram<L, B>,
	L,
	{
		sum: number;
		count: number;
		bucketValues: Map<B, number>;
		labels: LabelObject<L>;
	}
> {
	readonly #buckets: readonly B[];

	constructor(config: HistogramConfiguration<L, B>) {
		for (const label of config.labelNames ?? []) {
			if (label === "le") {
				throw new Error("le is a reserved label keyword");
			}
		}

		const buckets =
			config.buckets ??
			([0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] as B[]);
		for (const bucket of buckets) {
			if (!Number.isFinite(bucket)) {
				throw new TypeError(`Bucket is not a valid number: ${bucket}`);
			}
		}

		super(config);

		this.#buckets = [...new Set(buckets)].sort((a, b) => a - b);
		this.reset();
	}

	/**
	 * Observe a value
	 * @param value The value to observe
	 */
	observe(value: number): void;
	/**
	 * Observe a value for given labels
	 * @param labels Object with label keys and their values
	 * @param value The value to observe
	 */
	observe(labels: LabelObject<L>, value: number): void;
	observe(param1: LabelObject<L> | number, param2?: number) {
		const [value, labels] = parseMetricParams(param1, param2, 0);

		if (!Number.isFinite(value)) {
			throw new TypeError(`Value is not a valid number: ${value}`);
		}

		const hashed = hashLabels(labels);

		let entry = this.valueMap.get(hashed);
		if (!entry) {
			entry = this.#createValueEntry(labels);
			this.valueMap.set(hashed, entry);
		}

		entry.sum += value;
		entry.count += 1;

		const bucket = this.#buckets.find((b) => value <= b);

		if (!bucket) return;

		entry.bucketValues.set(bucket, (entry.bucketValues.get(bucket) ?? 0) + 1);
	}

	zero(labels: LabelObject<L>) {
		this.valueMap.set(hashLabels(labels), this.#createValueEntry(labels));
	}

	/**
	 * Start timer to log a duration
	 * @param startLabels Labels to record the time to
	 * @returns a function that ends the timer when called
	 */
	startTimer(startLabels: LabelObject<L> = {}) {
		return startTimer(this.observe.bind(this), startLabels);
	}

	/**
	 * Observes how long a function takes to execute. It can be used in two ways:
	 * @example
	 * ```typescript
	 * let result = histogram.time(doComputation, labels)(...args);
	 * class Foo {
	 * 	⁣@histogram.time(labels)
	 * 	doComputation() { }
	 * }
	 * ```
	 */
	time = createHook((labels) => this.startTimer(labels));

	/**
	 * Get sub-histogram for a given set of labels
	 * @param labels Labels to affect when used
	 */
	withLabels(labels: LabelObject<L>) {
		return {
			observe: (value: number) => {
				this.observe(labels, value);
			},
			zero: () => this.zero(labels),
			startTimer: () => {
				return this.startTimer(labels);
			},
			time: createHook(() => this.startTimer(labels)),
			reset: () => {
				this.valueMap.delete(hashLabels(labels));
			},
		};
	}

	reset() {
		this.valueMap.clear();
		if (!this.labelNames.length) {
			this.valueMap.set(hashLabels({}), this.#createValueEntry());
		}
	}

	#createValueEntry<L extends string>(labels: LabelObject<L> = {}) {
		return {
			sum: 0,
			count: 0,
			bucketValues: new Map(this.#buckets.map((v) => [v, 0] as const)),
			labels,
		};
	}
}
