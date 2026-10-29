import { globalRegistry, type Registry } from "../registry.ts";
import { getSymbol } from "../symbols.ts";
import {
	hashLabels,
	type LabelObject,
	validateLabelName,
	validateMetricName,
} from "../utils.ts";

export interface MetricConfiguration<T extends Metric<T, L>, L extends string> {
	/**
	 * The metric's name
	 */
	name: string;
	/**
	 * The metric's help string
	 */
	help: string;

	/**
	 * Optional metric name prefix, first part
	 */
	namespace?: string;
	/**
	 * Optional metric name prefix, second part
	 */
	subsystem?: string;
	/**
	 * Optional unit suffix appended to the metric name
	 */
	unit?: string;

	/**
	 * A list of labels. Also see the [prometheus docs](https://prometheus.io/docs/practices/instrumentation/#use-labels)
	 */
	labelNames?: readonly L[];
	/**
	 * A function that's ran when the metric is collected. Use for point-in-time observations
	 * @param this The current metric
	 */
	collect?: (this: T) => void | Promise<void>;
	/**
	 * An array of registries to register the metric to. Defaults to the global registry
	 */
	registries?: Registry[];
}

/**
 * Build a metric name from its namespace, subsystem, name and unit parts.
 */
export function buildMetricName(config: {
	name: string;
	namespace?: string;
	subsystem?: string;
	unit?: string;
}) {
	let name = "";
	if (config.namespace) name += `${config.namespace}_`;
	if (config.subsystem) name += `${config.subsystem}_`;
	name += config.name;
	if (config.unit && !name.endsWith(`_${config.unit}`)) {
		name += `_${config.unit}`;
	}
	return name;
}

/**
 * Subclasses are responsible for initializing their values once their own fields are ready.
 */
export abstract class Metric<
	// biome-ignore lint/suspicious/noExplicitAny: TODO: figure out a better way to deal with weird self-referential types
	T extends Metric<T, L, V> = any,
	L extends string = string,
	V extends object = object,
> {
	readonly name: string;
	readonly help: string;
	readonly unit: string | undefined;

	readonly labelNames: readonly string[];
	readonly #collect: MetricConfiguration<T, L>["collect"];
	readonly type: symbol;

	protected valueMap = new Map<string, V>();

	constructor(config: MetricConfiguration<T, L>) {
		const name = buildMetricName(config);
		validateMetricName(name);

		this.unit = config.unit;
		this.name = name;
		this.help = config.help;
		this.labelNames = config.labelNames ?? [];
		for (const labelName of this.labelNames) {
			validateLabelName(labelName);
		}
		this.#collect = config.collect;

		this.type = getSymbol(this.constructor.name);

		const registries = config.registries ?? [globalRegistry];
		for (const registry of registries) {
			registry.register(this);
		}
	}

	/**
	 * Only use this if you know what you're doing!
	 */
	getValues() {
		return this.valueMap.values();
	}

	/**
	 * Call the metric's assocated `collect` function, if it exists.
	 */
	collect() {
		return this.#collect?.call(this as unknown as T);
	}

	/**
	 * Remove the value for the given labels, so it is no longer exported.
	 * For metrics without labels, the value is reset to its default instead.
	 */
	remove(labels: LabelObject<L> = {}) {
		this.valueMap.delete(hashLabels(labels));
		if (!this.labelNames.length) {
			this.reset();
		}
	}

	/**
	 * Reset the metric's values
	 */
	abstract reset(): void;
}
