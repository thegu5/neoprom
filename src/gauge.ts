import { Metric } from "./metric.ts";
import { hashLabels, type LabelObject } from "./utils.ts";

export class Gauge<L extends string = string> extends Metric<
	Gauge<L>,
	L,
	{ value: number; labels: LabelObject<L> }
> {
	/**
	 * Increment gauge
	 * @param value The value to increment with
	 */
	inc(labels: LabelObject<L>, value?: number): void;
	inc(value?: number): void;
	inc(param1?: LabelObject<L> | number, param2?: number) {
		const value = (typeof param1 === "object" ? param2 : param1) ?? 1;
		const labels = typeof param1 === "object" ? param1 : ({} as LabelObject<L>);

		const hashed = hashLabels(labels);
		const entry = this.valueMap.get(hashed);

		if (entry) {
			entry.value += value;
		} else {
			this.valueMap.set(hashed, { value, labels });
		}
	}

	/**
	 * Decrement gauge
	 * @param value The value to decrement with
	 */
	dec(labels: LabelObject<L>, value?: number): void;
	dec(value?: number): void;
	dec(param1?: LabelObject<L> | number, param2?: number) {
		const value = (typeof param1 === "object" ? param2 : param1) ?? 1;
		const labels = typeof param1 === "object" ? param1 : ({} as LabelObject<L>);

		return this.inc(labels, -value);
	}

	/**
	 * Get sub-gauge for a given set of labels
	 * @param labels Labels to affect when used
	 */
	withLabels(labels: LabelObject<L>) {
		return {
			inc: (value?: number) => {
				this.inc(labels, value);
			},
			dec: (value?: number) => {
				this.dec(labels, value);
			},
			reset: () => {
				this.valueMap.delete(hashLabels(labels));
			},
		};
	}

	/**
	 * Reset the gauge
	 */
	reset() {
		this.valueMap.clear();
		if (!this.labelNames.length) {
			this.valueMap.set(hashLabels({}), { labels: {}, value: 0 }); // todo: is this correct behavior?
		}
	}
}
