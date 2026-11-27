import type { RequestHandler } from "express";
import {
	createMiddlewareHelper,
	type PrometheusOptions,
	UNMATCHED_ROUTE,
} from "./utils.ts";

export type { PrometheusOptions };

/** Collect HTTP metrics and serve /metrics. Register before application routes. */
export function prometheus(options: PrometheusOptions = {}): RequestHandler {
	const helper = createMiddlewareHelper(options);
	return (req, res, next) => {
		if (helper.isMetricsRequest(req.method, req.baseUrl + req.path)) {
			helper
				.renderMetrics(req.header("Accept"))
				.then(({ body, contentType }) => {
					res.status(200).contentType(contentType).send(body);
				})
				.catch(next);
			return;
		}

		const end = helper.startRequest();
		res.once("close", () => {
			end({
				method: req.method,
				route: req.route ? `${req.baseUrl}${req.route.path}` : UNMATCHED_ROUTE,
				status: res.statusCode,
				ok: String(res.statusCode >= 200 && res.statusCode < 300),
			});
		});
		next();
	};
}
