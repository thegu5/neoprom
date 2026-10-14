import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Histogram } from "../src/metrics/histogram.ts";
import { Registry } from "../src/registry.ts";

// import { beforeEach, describe, it } from "node:test";
// import { Counter, Histogram, globalRegistry } from "../src/index.ts";

// // none of these are actual tests yet, need to do assertions
// describe("Registry", () => {
// 	beforeEach(() => {
// 		globalRegistry.clear();
// 	});
// 	it("works? (temporary test)", async () => {
// 		const testCounter = new Counter({
// 			name: `test
//             Counter`,
// 			help: "yup",
// 			labelNames: ["f oo"],
// 		});
// 		testCounter.inc();
// 		testCounter.inc({ "f oo": "bar" }, 2);
// 		console.log(await globalRegistry.getMetrics());
// 	});
// 	it("does histogram stuff", async () => {
// 		const testHistogram = new Histogram({
// 			name: "a_histogram",
// 			help: ":)",
// 			labelNames: ["foo", "bar"],
// 		});
// 		testHistogram.observe({ foo: "asdf" }, 0.01);
// 		testHistogram.observe(10);
// 		testHistogram.observe({ foo: "asdf", bar: "awawa" }, 5);
// 		testHistogram.observe(0.1);
// 		testHistogram.observe(0.5);
// 		console.log(await globalRegistry.getMetrics());
// 	});
// });

describe("Registry histogram serialization", () => {
	for (const contentType of ["Prometheus", "OpenMetricsV1"] as const) {
		it(`serializes numeric bucket boundaries in ${contentType}`, async () => {
			const registry = new Registry({ contentType });
			const histogram = new Histogram({
				name: "request_duration_seconds",
				help: "Request duration",
				buckets: [0.1, 1],
				labelNames: ["route"],
				registries: [registry],
			});
			histogram.observe({ route: "/users/:id" }, 0.05);
			const metrics = await registry.getMetrics();
			for (const boundary of ["0.1", "1", "+Inf"]) {
				assert.ok(
					metrics.includes(
						`request_duration_seconds_bucket{le="${boundary}",route="/users/:id"} 1\n`,
					),
				);
			}
			assert.ok(
				metrics.includes(
					'request_duration_seconds_count{route="/users/:id"} 1\n',
				),
			);
		});
	}
});
