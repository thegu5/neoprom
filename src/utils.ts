export function hashLabels(labels: Record<string, string | undefined>) {
	return Object.entries(labels)
		.filter(([_name, value]) => value)
		.map(([name, value]) => `${name}:${value}`)
		.join(",");
}

export type LabelObject<L extends string = string> = Partial<Record<L, string>>;

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
