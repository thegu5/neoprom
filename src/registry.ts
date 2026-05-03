import type { Metric } from "./metric.ts";

export const RegistryContentType = {
	Prometheus: "text/plain; version=0.0.4; charset=utf-8",
	OpenMetrics: "application/openmetrics-text; version=1.0.0; charset=utf-8",
} as const;

export class Registry {
	readonly contentType: keyof typeof RegistryContentType;
	// biome-ignore lint/suspicious/noExplicitAny: not able to handle recursive generic here (?)
	#metrics = new Map<string, Metric<any, string>>();

	constructor(contentType: keyof typeof RegistryContentType = "OpenMetrics") {
		this.contentType = contentType;
	}

	registerMetric<T extends Metric<T, L>, L extends string>(metric: T) {
		if (this.#metrics.has(metric.name)) {
			throw new Error("metric with same name already exists");
		}
		this.#metrics.set(metric.name, metric);
	}

	resetMetrics() {
		for (const metric of this.#metrics.values()) {
			metric.reset();
		}
	}

	clear() {
		this.#metrics.clear();
	}
}
