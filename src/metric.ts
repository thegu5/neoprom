export type CollectFunction<T extends Metric<T, L>, L extends string> = (
	this: T,
) => void | Promise<void>;

export interface MetricConfiguration<T extends Metric<T, L>, L extends string> {
	name: string;
	help: string;
	labelNames?: readonly L[];
	collect?: CollectFunction<T, L>;
}

export abstract class Metric<T extends Metric<T, L>, L extends string> {
	readonly name: string;
	readonly help: string;
	readonly collect: MetricConfiguration<T, L>["collect"];
	constructor(config: MetricConfiguration<T, L>) {
		this.name = config.name;
		this.help = config.help;
		this.collect = config.collect;
	}
	abstract reset(): void;
}
