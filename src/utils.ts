export function hashLabels(labels: Record<string, string | undefined>) {
	return Object.entries(labels)
		.filter(([_name, value]) => value)
		.map(([name, value]) => `${name}:${value}`)
		.join(",");
}

export type LabelObject<L extends string = string> = Partial<Record<L, string>>;

export function parseMetricParams<L extends string>(
	param1: LabelObject<L> | number | undefined,
	param2: number | undefined,
	defaultValue: number,
) {
	const value = (typeof param1 === "object" ? param2 : param1) ?? defaultValue;
	const labels = typeof param1 === "object" ? param1 : ({} as LabelObject<L>);
	return [value, labels] as const;
}

export function startTimer<L extends string>(
	collectFunction: (labels: LabelObject<L>, value: number) => void,
	startLabels: LabelObject<L> = {},
) {
	const start = process.hrtime.bigint();
	return (endLabels: LabelObject<L> = {}) => {
		const delta = Number(process.hrtime.bigint() - start) / 1e9;
		collectFunction(Object.assign({}, startLabels, endLabels), delta);
		return delta;
	};
}
