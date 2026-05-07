import { Metric, type MetricConfiguration } from "./metric.ts";
import { hashLabels, type LabelObject, startTimer } from "./utils.ts";

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
	}

	/**
	 * Observe a value
	 * @param value The value to observe
	 */
	observe(value: number): void;
	observe(labels: LabelObject<L>, value: number): void;
	observe(param1: LabelObject<L> | number, param2?: number) {
		const value = (typeof param1 === "object" ? param2 : param1) ?? 0;
		const labels = typeof param1 === "object" ? param1 : ({} as LabelObject<L>);

		const hashed = hashLabels(labels);

		let entry = this.valueMap.get(hashed);
		if (!entry) {
			entry = createValueEntry(this.#buckets, labels);
			this.valueMap.set(hashed, entry);
		}

		if (!Number.isFinite(value)) {
			throw new TypeError(`Value is not a valid number: ${value}`);
		}

		entry.sum += value;
		entry.count += 1;

		const bucket = this.#buckets.find((b) => value <= b);

		if (!bucket) return;

		// idk if this is right
		entry.bucketValues[bucket] += 1;
	}

	/**
	 * Get sub-histogram for a given set of labels
	 * @param labels Labels to affect when used
	 */
	withLabels(labels: LabelObject<L>) {
		return {
			observe: (value: number) => {
				this.observe(labels, value);
			},
			reset: () => {
				this.valueMap.delete(hashLabels(labels));
			},
		};
	}

	/**
	 * Start timer to log a duration
	 * @param startLabels Labels to record the time to
	 */
	startTimer(startLabels: LabelObject<L> = {}) {
		return startTimer(this.observe, startLabels);
	}

	reset() {
		this.valueMap.clear();
		if (!this.labelNames.length) {
			this.valueMap.set(hashLabels({}), createValueEntry(this.#buckets, {})); // todo: is this correct behavior?
		}
	}
}

function createValueEntry<L extends string, B extends number>(
	buckets: readonly B[],
	labels: LabelObject<L>,
) {
	return {
		sum: 0,
		count: 0,
		bucketValues: Object.fromEntries(buckets.map((v) => [v, 0])) as Record<
			B,
			number
		>,
		labels,
	};
}
