import { createMiddleware } from "hono/factory";
import { routePath } from "hono/route";
import {
	createMiddlewareHelper,
	type PrometheusOptions,
	UNMATCHED_ROUTE,
} from "./utils.ts";

export type { PrometheusOptions };

export function prometheus(options: PrometheusOptions = {}) {
	const metrics = createMiddlewareHelper(options);
	return createMiddleware(async (c, next) => {
		if (metrics.isMetricsRequest(c.req.method, c.req.path)) {
			const { body, contentType } = await metrics.renderMetrics(
				c.req.header("Accept"),
			);
			return c.body(body, 200, { "Content-Type": contentType });
		}

		const end = metrics.startRequest();
		let status = 500; // if next() throws, the server will respond with a 500
		try {
			await next();
			status = c.res.status;
		} finally {
			end({
				method: c.req.method,
				route: routePath(c) || UNMATCHED_ROUTE,
				status,
				ok: String(status >= 200 && status < 300),
			});
		}
	});
}
