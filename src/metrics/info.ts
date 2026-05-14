import { hashLabels, type LabelObject } from "../utils.ts";
import { Metric, type MetricConfiguration } from "./metric.ts";

export class Info<L extends string = string> extends Metric<
	Info<L>,
	L,
	{ labels: Record<string, string> }
> {
	constructor(options: Omit<MetricConfiguration<Info<L>, L>, "unit">) {
		// normalize name so it's the same between the prometheus text format and openmetrics
		if (!options.name.endsWith("_info")) {
			options.name += "_info";
		}
		super(options);
	}

	set(info: Record<string, string>): void;
	set(labels: LabelObject<L>, info: Record<string, string>): void;
	set(
		param1: Record<string, string> | LabelObject<L>,
		param2?: Record<string, string>,
	) {
		const labels = (param2 ? param1 : {}) as LabelObject<L>;
		const info = param2 ?? (param1 as Record<string, string>);

		for (const key of Object.keys(info)) {
			if (this.labelNames.includes(key)) {
				throw new Error(`Info name "${key}" cannot overlap with label name`);
			}
		}

		this.valueMap.set(hashLabels(labels), {
			labels: Object.assign({}, labels, info),
		});
	}

	/**
	 * Get sub-info for a given set of labels
	 * @param labels Labels to affect when used
	 */
	withLabels(labels: LabelObject<L>) {
		return {
			set: (info: Record<string, string>) => {
				this.set(labels, info);
			},
			reset: () => {
				this.valueMap.delete(hashLabels(labels));
			},
		};
	}

	reset() {
		this.valueMap.clear();
	}
}
