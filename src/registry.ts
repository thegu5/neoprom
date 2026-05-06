import { Counter } from "./counter.ts";
import { Gauge } from "./gauge.ts";
import type { Histogram } from "./histogram.ts";
import type { LabelObject } from "./utils.ts";

export const RegistryContentType = {
	Prometheus: "text/plain; version=0.0.4; charset=utf-8",
	OpenMetrics: "application/openmetrics-text; version=1.0.0; charset=utf-8",
} as const;

type MetricUnion = Counter | Gauge | Histogram;

export class Registry {
	readonly contentType: keyof typeof RegistryContentType;
	#metrics = new Map<string, MetricUnion>();

	constructor(contentType: keyof typeof RegistryContentType = "OpenMetrics") {
		this.contentType = contentType;
	}

	register(...metrics: MetricUnion[]) {
		for (const metric of metrics) {
			if (this.#metrics.has(metric.name)) {
				throw new Error("metric with same name already exists");
			}
			this.#metrics.set(metric.name, metric);
		}
	}

	resetMetrics() {
		for (const metric of this.#metrics.values()) {
			metric.reset();
		}
	}

	clear() {
		this.#metrics.clear();
	}

	async getMetrics() {
		if (this.contentType === "OpenMetrics") {
			throw new Error("OpenMetrics Registry content type is not yet supported");
		}

		await Promise.all(
			Array.from(this.#metrics.values(), (metric) => metric.collect()),
		);

		let result = "";

		// https://prometheus.io/docs/instrumenting/exposition_formats/#comments-help-text-and-type-information
		for (const metric of this.#metrics.values()) {
			// todo: how are metric types in comments escaped?
			result += `# HELP ${metric.name} ${metric.help.replaceAll("\\", "\\\\").replaceAll("\n", "\\n")}\n`;
			result += `# TYPE ${metric.name} ${metric.constructor.name.toLowerCase()}\n`;

			if (metric instanceof Counter || metric instanceof Gauge) {
				for (const val of metric.getValues()) {
					result += getMetricLine(metric.name, val.value, val.labels);
				}
			} else {
				throw new Error(
					`${metric.constructor.name} metric type not fully implemented`,
				);
			}
		}

		return result;
	}
}

function getMetricLine(name: string, value: unknown, labels: LabelObject) {
	const altFormat = requiresEscaping(name);
	let result = "";
	result += altFormat ? "" : name;
	if (Object.values(labels).filter((v) => v !== undefined).length) {
		result += `{${altFormat ? `"${escapeIdentifier(name)},"` : ""}${getLabelPairs(labels)}}`;
	}
	result += ` ${value}\n`;
	return result;
}

function getLabelPairs(labels: LabelObject) {
	return Object.entries(labels)
		.filter((e): e is [string, string] => e[1] !== undefined)
		.map(
			([labelName, labelValue]) =>
				`${escapeIfRequired(labelName)}=${escapeIdentifier(labelValue)}`,
		)
		.join(",");
}

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
