import { globalRegistry, type Registry } from "./registry.ts";
import { getSymbol } from "./symbols.ts";

export interface MetricConfiguration<T extends Metric<T, L>, L extends string> {
	name: string;
	help: string;
	labelNames?: readonly L[];
	collect?: (this: T) => void | Promise<void>;
	registries?: Registry[];
}

export abstract class Metric<
	// biome-ignore lint/suspicious/noExplicitAny: todo: figure out a better way to deal with weird self-referential types
	T extends Metric<T, L> = any,
	L extends string = string,
	V extends object = object,
> {
	readonly name: string;
	readonly help: string;
	readonly labelNames: readonly string[];
	readonly #collect: MetricConfiguration<T, L>["collect"];
	readonly type: symbol;

	protected valueMap = new Map<string, V>();

	constructor(config: MetricConfiguration<T, L>) {
		this.name = config.name;
		this.help = config.help;
		this.labelNames = config.labelNames ?? [];
		this.#collect = config.collect;

		this.type = getSymbol(this.constructor.name);

		const registries = config.registries ?? [ globalRegistry ];
		for (const registry of registries) {
			registry.register(this);
		}
	}

	getValues() {
		return this.valueMap.values();
	}

	collect() {
		return this.#collect?.call(this as unknown as T);
	}

	abstract reset(): void;
}
