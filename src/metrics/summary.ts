import { TDigest } from "../quantiles/tdigest.ts";
import { TimeWindowQuantiles } from "../quantiles/timeWindowQuantiles.ts";
import {
	createHook,
	hashLabels,
	isIn,
	type LabelObject,
	parseMetricParams,
	startTimer,
} from "../utils.ts";
import { Metric, type MetricConfiguration } from "./metric.ts";

export const PERCENTILES = [0.01, 0.05, 0.5, 0.9, 0.95, 0.99, 0.999];

export interface SummaryConfiguration<L extends string>
	extends MetricConfiguration<Summary<L>, L> {
	/**
	 * The percentiles to expose, each between 0 and 1.
	 * Set both `maxAgeSeconds` and `ageBuckets` to use a sliding window.
	 * Defaults to `[]`, exposing only `_sum` and `_count`.
	 * A good set of default percentiles is exported from this module as `PERCENTILES`.
	 */
	percentiles?: readonly number[];
	/**
	 * Determines whether labeled metric values should always be present,
	 * even if empty (aged out of the sliding window).
	 * Defaults to false.
	 */
	pruneAgedBuckets?: boolean;
	/**
	 * The length of the sliding window the quantiles are calculated over, in seconds.
	 * Sliding windows are enabled only when both this and `ageBuckets` are supplied.
	 */
	maxAgeSeconds?: number;
	/**
	 * The number of buckets the window is divided into. The window slides forward by
	 * one bucket at a time, so more buckets make it move more smoothly.
	 * Sliding windows are enabled only when both this and `ageBuckets` are supplied.
	 */
	ageBuckets?: number;
}

export interface SummaryValue<L extends string = string> {
	labels: LabelObject<L>;
	/** Sum of all observations. Like `count`, this is cumulative rather than windowed */
	sum: number;
	/** Number of observations */
	count: number;
	/** Only present when the summary has quantiles */
	window: TimeWindowQuantiles | TDigest | undefined;
}

export class Summary<L extends string = string> extends Metric<
	Summary<L>,
	L,
	SummaryValue<L>
> {
	readonly #quantiles: readonly number[];

	readonly #maxAgeSeconds: number | undefined;
	readonly #ageBuckets: number | undefined;
	readonly #pruneAgedBuckets: boolean;

	constructor(options: SummaryConfiguration<L>) {
		if (isIn(options.labelNames ?? [], "quantile")) {
			throw new Error('"quantile" is a reserved label keyword');
		}
		const quantiles = options.percentiles ?? [];
		for (const q of quantiles) {
			if (!(q >= 0 && q <= 1)) {
				throw new RangeError(`Quantile ${q} must be between 0 and 1`);
			}
		}
		const maxAgeSeconds = options.maxAgeSeconds;
		if (
			maxAgeSeconds !== undefined &&
			(!(maxAgeSeconds > 0) || !Number.isFinite(maxAgeSeconds))
		) {
			throw new RangeError("maxAgeSeconds must be a positive number");
		}
		const ageBuckets = options.ageBuckets;
		if (
			ageBuckets !== undefined &&
			(!Number.isInteger(ageBuckets) || ageBuckets < 1)
		) {
			throw new RangeError("ageBuckets must be a positive integer");
		}

		super(options);

		this.#quantiles = [...new Set(quantiles)].sort((a, b) => a - b);
		this.#maxAgeSeconds = maxAgeSeconds;
		this.#ageBuckets = ageBuckets;
		this.#pruneAgedBuckets = options.pruneAgedBuckets ?? false;

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
		entry.window?.observe(value);
	}

	/**
	 * Get this summary's values, first removing series whose quantile window has
	 * fully aged out when `pruneAgedBuckets` is enabled
	 */
	override getValues() {
		if (this.#pruneAgedBuckets) {
			for (const [hash, entry] of this.valueMap) {
				if (entry.window && entry.window.count === 0) {
					this.valueMap.delete(hash);
				}
			}
		}
		return super.getValues();
	}

	/**
	 * Get the estimated quantile values for one of this summary's values (as returned
	 * by `getValues()`), over all observations or the configured sliding window
	 * @returns `[quantile, value]` pairs, sorted by quantile. Values are `NaN` if there
	 * were no observations in the configured scope
	 */
	getQuantiles(entry: SummaryValue<L>): [quantile: number, value: number][] {
		const { window } = entry;

		if (!window) return [];

		if (window instanceof TDigest) {
			return this.#quantiles.map((q) => [q, window.quantile(q)]);
		}

		const values = window.quantiles(this.#quantiles);
		return this.#quantiles.map((q, i) => [q, values[i]]);
	}

	zero(labels: LabelObject<L>) {
		this.valueMap.set(hashLabels(labels), this.#createValueEntry(labels));
	}

	/**
	 * Start timer to log a duration in seconds
	 * @param startLabels Labels to record the time to
	 * @returns a function that ends the timer when called
	 */
	startTimer(startLabels: LabelObject<L> = {}) {
		return startTimer(this.observe.bind(this), startLabels);
	}

	/**
	 * Observes how long a function takes to execute, in seconds. It can be used in two ways:
	 * @example
	 * ```typescript
	 * let result = summary.time(doComputation, labels)(...args);
	 * class Foo {
	 * 	⁣@summary.time(labels)
	 * 	doComputation() { }
	 * }
	 * ```
	 */
	time = createHook((labels) => this.startTimer(labels));

	/**
	 * Get sub-summary for a given set of labels
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

	#createValueEntry(labels: LabelObject<L> = {}): SummaryValue<L> {
		return {
			labels,
			sum: 0,
			count: 0,
			window: this.#quantiles.length
				? this.#maxAgeSeconds && this.#ageBuckets
					? new TimeWindowQuantiles(this.#maxAgeSeconds, this.#ageBuckets)
					: new TDigest()
				: undefined,
		};
	}
}
