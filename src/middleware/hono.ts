import type { MiddlewareHandler } from "hono";
import { routePath } from "hono/route";
import { Counter } from "../metrics/counter.ts";
import { Histogram } from "../metrics/histogram.ts";
import { Registry, RegistryContentType } from "../registry.ts";

export interface PrometheusOptions {
	/** Registry for HTTP and custom metrics. Defaults to a new, isolated registry. */
	registry?: Registry;
}

/** Collect HTTP metrics and serve /metrics. Register before application routes. */
export function prometheus(options: PrometheusOptions = {}): MiddlewareHandler {
	const registry = options.registry ?? new Registry();
	const labelNames = ["method", "route", "status", "ok"] as const;
	const requestDuration = new Histogram({
		name: "http_request_duration_seconds",
		help: "Duration of HTTP requests in seconds",
		unit: "seconds",
		labelNames,
		registries: [registry],
	});
	const requestsTotal = new Counter({
		name: "http_requests_total",
		help: "Total number of HTTP requests",
		labelNames,
		registries: [registry],
	});

	return async (c, next) => {
		if (c.req.method === "GET" && c.req.path === "/metrics") {
			const contentType = negotiateContentType(
				c.req.header("Accept"),
				registry.contentType,
			);
			console.log(`negotiated content type ${contentType}`);
			const header =
				contentType === RegistryContentType.OpenMetricsV1
					? `${contentType}; escaping=allow-utf-8`
					: contentType;
			return c.body(await registry.getMetrics(contentType), 200, {
				"Content-Type": header,
			});
		}

		const start = performance.now();
		try {
			await next();
		} finally {
			const labels = {
				method: c.req.method,
				route: routePath(c) || "*",
				status: String(c.res.status),
				ok: String(c.res.ok),
			};
			requestDuration.observe(labels, (performance.now() - start) / 1000);
			requestsTotal.inc(labels);
		}
	};
}

function negotiateContentType(
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
		// The registry implements UTF-8 names, not the other escaping schemes.
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
