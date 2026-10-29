import { hashLabels, isIn, type LabelObject } from "../utils.ts";
import { buildMetricName, Metric, type MetricConfiguration } from "./metric.ts";

export interface StateSetConfiguration<L extends string, S extends string>
	extends MetricConfiguration<StateSet<L, S>, L> {
	states?: readonly S[];
}

export class StateSet<
	L extends string = string,
	S extends string = string,
> extends Metric<
	StateSet<L, S>,
	L,
	{ states: Record<S, boolean>; labels: LabelObject<L> }
> {
	readonly #states: readonly S[];
	constructor(options: StateSetConfiguration<L, S>) {
		const name = buildMetricName(options);
		if (isIn(options.labelNames ?? [], name)) {
			throw new Error(
				`Label name ${name} cannot be the same as the metric name`,
			);
		}
		if (!options.states?.length) {
			throw new Error("StateSet must have at least one state");
		}
		super(options);
		this.#states = options.states;

		this.reset();
	}
	/**
	 * Apply state values for labels
	 * @param labels An object containing label names and their values
	 * @param value The states
	 */
	set(labels: LabelObject<L>, states: Partial<Record<S, boolean>>): void;
	/**
	 * Apply state values to the set
	 * @param value The states
	 */
	set(states: Partial<Record<S, boolean>>): void;
	set(
		param1?: LabelObject<L> | Partial<Record<S, boolean>>,
		param2?: Partial<Record<S, boolean>>,
	) {
		const labels = param2 ? (param1 as LabelObject<L>) : (param2 ?? {});
		const states = param2 ? param2 : (param1 as Record<S, boolean>);

		if (!this.valueMap.has(hashLabels(labels))) {
			this.valueMap.set(hashLabels(labels), this.#createValueEntry(labels));
		}

		// biome-ignore lint/style/noNonNullAssertion: must exist, see above
		const old = this.valueMap.get(hashLabels(labels))!;
		Object.assign(old.states, states);
	}

	/**
	 * Get sub-state for a given set of labels
	 * @param labels Labels to affect when used
	 */
	withLabels(labels: LabelObject<L>) {
		return {
			set: (states: Partial<Record<S, boolean>>) => {
				this.set(labels, states);
			},
			zero: () => this.zero(labels),
			reset: () => {
				this.valueMap.delete(hashLabels(labels));
			},
		};
	}

	zero(labels: LabelObject<L>) {
		this.valueMap.set(hashLabels(labels), this.#createValueEntry(labels));
	}

	reset() {
		this.valueMap.clear();
		if (!this.labelNames.length) {
			this.valueMap.set(hashLabels({}), this.#createValueEntry());
		}
	}

	#createValueEntry(labels: LabelObject<L> = {}) {
		return {
			states: Object.fromEntries(this.#states.map((s) => [s, false])) as Record<
				S,
				boolean
			>,
			labels,
		};
	}
}
