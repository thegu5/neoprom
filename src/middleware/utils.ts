import { Counter } from "../metrics/counter.ts";
import { Histogram } from "../metrics/histogram.ts";
import { Registry, RegistryContentType } from "../registry.ts";

export interface PrometheusOptions {
	/** Registry for HTTP and custom metrics. Defaults to a new, isolated registry */
	registry?: Registry;
	/** Prefix for all HTTP metrics */
	prefix?: string;
	/** Full path to serve the metrics on. Defaults to `/metrics` */
	metricsPath?: string;
}

export const UNMATCHED_ROUTE = "*";

export function createMiddlewareHelper(options: PrometheusOptions = {}) {
	const registry = options.registry ?? new Registry();
	const metricsPath = options.metricsPath ?? "/metrics";
	const { requestDuration, requestsTotal } = buildHttpMetrics(options);
	registry.register(requestDuration, requestsTotal);

	return {
		registry,

		/** `path` must be the full request path, including any mount prefix */
		isMetricsRequest(method: string, path: string): boolean {
			return method === "GET" && path === metricsPath;
		},

		async renderMetrics(accept: string | undefined) {
			const type = negotiateContentType(accept, registry.contentType);
			return {
				body: await registry.getMetrics(type),
				contentType:
					type === RegistryContentType.OpenMetricsV1
						? `${type}; escaping=allow-utf-8`
						: type,
			};
		},

		startRequest() {
			const start = performance.now();
			return (result: {
				method: string;
				route: string;
				status: number;
				ok: string;
			}) => {
				const labels = {
					method: result.method,
					route: result.route,
					status: String(result.status),
					ok: String(result.status >= 200 && result.status < 300),
				};
				requestDuration.observe(labels, (performance.now() - start) / 1000);
				requestsTotal.inc(labels);
			};
		},
	};
}

export function buildHttpMetrics(options?: PrometheusOptions) {
	const labelNames = ["method", "route", "status", "ok"] as const;
	const requestDuration = new Histogram({
		name: "http_request_duration_seconds",
		namespace: options?.prefix,
		help: "Duration of HTTP requests in seconds",
		unit: "seconds",
		labelNames,
		// https://opentelemetry.io/docs/specs/semconv/http/http-metrics/#metric-httpserverrequestduration
		buckets: [
			0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10,
		],
	});
	const requestsTotal = new Counter({
		name: "http_requests_total",
		namespace: options?.prefix,
		help: "Total number of HTTP requests",
		labelNames,
	});
	return { requestDuration, requestsTotal };
}

export function negotiateContentType(
	accept: string | undefined,
	fallback: Registry["contentType"],
): Registry["contentType"] {
	let selected = fallback;
	let highestQuality = 0;
	for (const range of accept?.split(",") ?? []) {
		const [mime, ...parameters] = range.trim().toLowerCase().split(";");
		const params = new Map(
			parameters.map((parameter) => {
				const [key, value = ""] = parameter.trim().split("=");
				return [key, value.replace(/^"(.*)"$/, "$1")];
			}),
		);
		const qualityText = params.get("q") ?? "1";
		if (!/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(qualityText)) continue;
		const quality = Number(qualityText);
		if (quality <= highestQuality) continue;
		// we only implement the utf-8 escaping strategy
		if (params.has("escaping") && params.get("escaping") !== "allow-utf-8") {
			continue;
		}
		let contentType: Registry["contentType"];
		if (mime === "text/plain" && params.get("version") === "0.0.4") {
			contentType = RegistryContentType.Prometheus;
		} else if (
			mime === "application/openmetrics-text" &&
			params.get("version") === "1.0.0"
		) {
			contentType = RegistryContentType.OpenMetricsV1;
		} else {
			continue;
		}
		selected = contentType;
		highestQuality = quality;
	}
	return selected;
}
