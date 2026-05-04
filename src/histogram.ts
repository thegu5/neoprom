import { Metric, type MetricConfiguration } from "./metric.ts";
import { hashLabels, type LabelObject } from "./utils.ts";

export interface HistogramConfiguration<L extends string, B extends number>
	extends MetricConfiguration<Histogram<L, B>, L> {
	buckets: readonly B[];
}

export class Histogram<L extends string, B extends number> extends Metric<
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

		this.#buckets = config.buckets;
	}

	/**
	 * Observe a value
	 * @param value The value to observe
	 */
	observe(labels: LabelObject<L>, value: number) {
		const hashed = hashLabels(labels);

		let entry = this.values.get(hashed);
		if (!entry) {
			entry = createValueEntry(this.#buckets, labels);
			this.values.set(hashed, entry);
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
				this.values.delete(hashLabels(labels));
			},
		};
	}

	/**
	 * Start timer to log a duration
	 * @param startLabels Labels to record the time to
	 */
	startTimer(startLabels: LabelObject<L> = {}) {
		const start = process.hrtime.bigint();
		return (endLabels: LabelObject<L> = {}) => {
			const delta = Number((process.hrtime.bigint() - start) / BigInt(1e9));
			this.observe(Object.assign({}, startLabels, endLabels), delta);
			return delta;
		};
	}

	reset() {
		this.values.clear();
		if (!this.labelNames.length) {
			this.values.set(hashLabels({}), createValueEntry(this.#buckets, {})); // todo: is this correct behavior?
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
