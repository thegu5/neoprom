import { Metric, type MetricConfiguration } from "./metric.ts";
import {
	createHook,
	hashLabels,
	type LabelObject,
	parseMetricParams,
	startTimer,
} from "./utils.ts";

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
		bucketValues: Record<B, number>;
		labels: LabelObject<L>;
	}
> {
	readonly #buckets: readonly B[];

	constructor(config: HistogramConfiguration<L, B>) {
		super(config);

		for (const label of this.labelNames) {
			if (label === "le") {
				throw new Error("le is a reserved label keyword");
			}
		}

		this.#buckets =
			config.buckets ??
			([0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] as B[]);

		// needs to be done here instead of Metric's constructor since buckets aren't set up yet
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

		const hashed = hashLabels(labels);

		let entry = this.valueMap.get(hashed);
		if (!entry) {
			entry = this.#createValueEntry(labels);
			this.valueMap.set(hashed, entry);
		}

		if (!Number.isFinite(value)) {
			throw new TypeError(`Value is not a valid number: ${value}`);
		}

		entry.sum += value;
		entry.count += 1;

		const bucket = this.#buckets.find((b) => value <= b);

		if (!bucket) return;

		entry.bucketValues[bucket] += 1;
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
		// skip when called from `Metric`'s constructor
		try {
			this.#buckets;
		} catch (_) {
			return;
		}

		this.valueMap.clear();
		if (!this.labelNames.length) {
			this.valueMap.set(hashLabels({}), this.#createValueEntry());
		}
	}

	#createValueEntry<L extends string, B extends number>(
		labels: LabelObject<L> = {},
	) {
		return {
			sum: 0,
			count: 0,
			bucketValues: Object.fromEntries(
				this.#buckets.map((v) => [v, 0]),
			) as Record<B, number>,
			labels,
		};
	}
}
