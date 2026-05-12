import type { Counter } from "./counter.ts";
import type { Gauge } from "./gauge.ts";
import type { Histogram } from "./histogram.ts";
import type { Metric } from "./metric.ts";
import { getSymbol } from "./symbols.ts";
import type { LabelObject } from "./utils.ts";

export const RegistryContentType = {
	Prometheus: "text/plain; version=0.0.4; charset=utf-8",
	OpenMetrics: "application/openmetrics-text; version=1.0.0; charset=utf-8",
} as const;

interface RegistryOptions {
	/**
	 * The content type of the registry's output. Defaults to `Prometheus`
	 */
	contentType?: keyof typeof RegistryContentType;
	/**
	 * Default labels to apply to every metric
	 */
	defaultLabels?: Record<string, string>;
}

export class Registry {
	readonly #contentType: keyof typeof RegistryContentType;
	readonly #defaultLabels: Record<string, string>;

	#metrics = new Map<string, Metric>();

	constructor(options?: RegistryOptions) {
		this.#contentType = options?.contentType ?? "Prometheus";
		this.#defaultLabels = options?.defaultLabels ?? {};
	}

	/**
	 * Register a metric or list of metrics
	 */
	register(...metrics: Metric[]) {
		for (const metric of metrics) {
			if (this.#metrics.has(metric.name)) {
				throw new Error("metric with same name already exists");
			}
			this.#metrics.set(metric.name, metric);
		}
	}

	/**
	 * Reset values of all registered metrics
	 */
	resetMetrics() {
		for (const metric of this.#metrics.values()) {
			metric.reset();
		}
	}

	/**
	 * Clear the list of registered metrics
	 */
	clear() {
		this.#metrics.clear();
	}

	/**
	 * Collect the registered metrics and format as a string
	 */
	async getMetrics() {
		await Promise.all(
			Array.from(this.#metrics.values(), (metric) => metric.collect()),
		);

		let result = "";

		// https://prometheus.io/docs/instrumenting/exposition_formats/#comments-help-text-and-type-information
		for (const metric of this.#metrics.values()) {
			// metric is empty
			if (!metric.getValues().toArray().length) continue;

			// TODO: how are metric names in comments escaped?
			result += `# HELP ${escapeIfRequired(metric.name)} ${metric.help.replaceAll("\\", "\\\\").replaceAll("\n", "\\n")}\n`;
			if (this.#contentType === "OpenMetrics" && metric.unit) {
				result += `# UNIT ${escapeIfRequired(metric.name)} ${metric.unit}`;
			}
			result += `# TYPE ${escapeIfRequired(metric.name)} ${metric.constructor.name.toLowerCase()}\n`;

			if (metric.type === getSymbol("Counter")) {
				for (const val of (metric as Counter).getValues()) {
					const labels = Object.assign({}, this.#defaultLabels, val.labels);

					result += getMetricLine(metric.name, val.value, labels);
				}
			} else if (metric.type === getSymbol("Gauge")) {
				for (const val of (metric as Gauge).getValues()) {
					const labels = Object.assign({}, this.#defaultLabels, val.labels);

					result += getMetricLine(metric.name, val.value, labels);
				}
			} else if (metric.type === getSymbol("Histogram")) {
				for (const val of (metric as Histogram).getValues()) {
					const labels = Object.assign({}, this.#defaultLabels, val.labels);

					let agg = 0;
					for (const [bucket, count] of Object.entries(val.bucketValues).sort(
						([a], [b]) => parseInt(a, 10) - parseInt(b, 10),
					)) {
						agg += count;
						result += getMetricLine(
							`${metric.name}_bucket`,
							agg,
							Object.assign({ le: bucket }, labels),
						);
					}

					result += getMetricLine(
						`${metric.name}_bucket`,
						val.count,
						Object.assign({ le: "+Inf" }, labels),
					);

					result += getMetricLine(`${metric.name}_sum`, val.sum, labels);
					result += getMetricLine(`${metric.name}_count`, val.count, labels);
				}
			} else {
				// (currently) unreachable
				// throw new Error(
				// 	`${metric.constructor.name} metric type not fully implemented`,
				// );
			}
		}
		if (this.#contentType === "OpenMetrics") {
			result += "# EOF\n";
		}
		return result;
	}
}

function getMetricLine(
	name: string,
	value: number | string,
	labels: LabelObject,
) {
	const altFormat = requiresEscaping(name);
	const bracketEntries = getLabelPairs(labels);
	if (altFormat) bracketEntries.unshift(escapeIdentifier(name));
	let result = "";
	result += altFormat ? "" : name;
	if (bracketEntries.length) {
		result += `{${bracketEntries.join(",")}}`;
	}
	// normalize infinity - both should parse correctly, but all other libraries do this
	result += ` ${value.toString().replace("Infinity", "Inf")}\n`;
	return result;
}

function getLabelPairs(labels: LabelObject) {
	return Object.entries(labels)
		.filter((e): e is [string, string] => e[1] !== undefined)
		.map(
			([labelName, labelValue]) =>
				`${escapeIfRequired(labelName)}=${escapeIdentifier(labelValue)}`,
		);
}

// TODO: label names can't have colons?
function requiresEscaping(identifier: string) {
	return !/^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(identifier);
}

function escapeIdentifier(identifier: string) {
	return `"${identifier
		.replaceAll("\\", "\\\\")
		.replaceAll('"', '\\"')
		.replaceAll("\n", "\\n")}"`;
}

function escapeIfRequired(identifier: string) {
	return requiresEscaping(identifier)
		? escapeIdentifier(identifier)
		: identifier;
}

export const globalRegistry = new Registry();
