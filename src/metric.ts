export type CollectFunction<T extends Metric<T, L>, L extends string> = (
	this: T,
) => void | Promise<void>;

export interface MetricConfiguration<T extends Metric<T, L>, L extends string> {
	name: string;
	help: string;
	labelNames?: readonly L[];
	collect?: CollectFunction<T, L>;
}

export abstract class Metric<
	T extends Metric<T, L>,
	L extends string = string,
	V extends object = object,
> {
	readonly name: string;
	readonly help: string;
	readonly labelNames: readonly string[];
	readonly #collect: MetricConfiguration<T, L>["collect"];

	protected values = new Map<string, V>();

	constructor(config: MetricConfiguration<T, L>) {
		this.name = config.name;
		this.help = config.help;
		this.labelNames = config.labelNames ?? [];
		this.#collect = config.collect;
	}

	getValues() {
		// this might benefit from better naming
		return this.values.values();
	}

	collect() {
		return this.#collect?.call(this as unknown as T);
	}

	abstract reset(): void;
}
