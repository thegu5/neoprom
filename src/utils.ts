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

// horror. (todo: can the typing here be cleaned up...?)
export function createHook<L extends string>(
	startHook: (labels: LabelObject<L>) => () => void,
	options?: { includeExceptions?: boolean },
) {
	function wrapper<
		F extends (this: T, ...args: R) => unknown,
		R extends unknown[],
		T,
	>(fn: F): F;
	function wrapper<
		F extends (this: T, ...args: R) => unknown,
		R extends unknown[],
		T,
	>(labels: LabelObject<L>, fn: F): F;
	function wrapper(
		labels?: LabelObject<L>,
	): <T, R extends unknown[]>(
		target: (this: T, ...args: R) => unknown,
		context: ClassMethodDecoratorContext,
	) => (this: T, ...args: R) => unknown;
	function wrapper(
		param1?: LabelObject<L> | ((...args: unknown[]) => unknown),
		param2?: (...args: unknown[]) => unknown,
	) {
		const isWrapperMode =
			typeof param1 === "function" || typeof param2 === "function";
		const labels = (typeof param1 === "object" ? param1 : {}) as LabelObject<L>;

		if (isWrapperMode) {
			// biome-ignore lint/style/noNonNullAssertion: the overload sufficiently narrows this
			const func = typeof param1 === "function" ? param1 : param2!;
			return function (this: unknown, ...args: unknown[]) {
				const endHook = startHook(labels);
				try {
					const result = func.call(this, ...args);
					return result;
				} finally {
					if (options?.includeExceptions) endHook();
				}
			};
		}

		return <T, R extends unknown[]>(
			target: (this: T, ...args: R) => unknown,
			context: ClassMethodDecoratorContext,
		) =>
			function (this: T, ...args: R) {
				const endHook = startHook({
					method: String(context.name), // todo: is this a good idea?
					...labels,
				} as LabelObject<L>);
				try {
					const result = target.call(this, ...args);
					return result;
				} finally {
					if (options?.includeExceptions) endHook();
				}
			};
	}

	return wrapper;
}
