export function hashLabels(labels: Record<string, string | undefined>) {
	return Object.entries(labels)
		.filter(([_name, value]) => value)
		.map(([name, value]) => `${name}:${value}`)
		.join(",");
}

export type LabelObject<L extends string = string> = Partial<Record<L, string>>;
