import * as assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
	Counter,
	Gauge,
	globalRegistry,
	Histogram,
	Registry,
} from "../src/index.ts";

describe("metric names", () => {
	beforeEach(() => {
		globalRegistry.clear();
	});

	it("builds names as namespace_subsystem_name", () => {
		const counter = new Counter({
			name: "requests",
			help: "test",
			namespace: "app",
			subsystem: "http",
		});

		assert.equal(counter.name, "app_http_requests_total");
	});

	it("rejects invalid metric names", () => {
		assert.throws(
			() => new Counter({ name: "invalid name", help: "test" }),
			/Invalid metric name/,
		);
	});

	it("rejects invalid label names", () => {
		assert.throws(
			() =>
				new Counter({
					name: "valid_name",
					help: "test",
					labelNames: ["invalid label"],
				}),
			/Invalid label name/,
		);
	});
});

describe("labeled metric helpers", () => {
	beforeEach(() => {
		globalRegistry.clear();
	});

	it("removes a single child", () => {
		const counter = new Counter({
			name: "counter_remove",
			help: "test",
			labelNames: ["method"],
		});
		counter.inc({ method: "GET" });
		counter.inc({ method: "POST" });

		counter.remove({ method: "GET" });

		assert.deepEqual(Array.from(counter.getValues()), [
			{ labels: { method: "POST" }, value: 1 },
		]);
	});

	it("clears all children", () => {
		const gauge = new Gauge({
			name: "gauge_clear",
			help: "test",
			labelNames: ["method"],
		});
		gauge.inc({ method: "GET" });
		gauge.inc({ method: "POST" });

		gauge.reset();

		assert.deepEqual(Array.from(gauge.getValues()), []);
	});

	it("initializes a child with zero()", () => {
		const counter = new Counter({
			name: "counter_zero",
			help: "test",
			labelNames: ["method"],
		});

		counter.zero({ method: "GET" });

		assert.deepEqual(Array.from(counter.getValues()), [
			{ labels: { method: "GET" }, value: 0 },
		]);
	});

	it("initializes a child through withLabels().zero()", () => {
		const gauge = new Gauge({
			name: "gauge_zero",
			help: "test",
			labelNames: ["method"],
		});

		gauge.withLabels({ method: "GET" }).zero();

		assert.deepEqual(Array.from(gauge.getValues()), [
			{ labels: { method: "GET" }, value: 0 },
		]);
	});
});

describe("counter validation", () => {
	beforeEach(() => {
		globalRegistry.clear();
	});

	it("rejects NaN increments", () => {
		const counter = new Counter({ name: "counter_nan", help: "test" });

		assert.throws(() => counter.inc(Number.NaN), /counter cannot decrease/);
	});
});

describe("histogram buckets", () => {
	beforeEach(() => {
		globalRegistry.clear();
	});

	it("sorts and deduplicates buckets", () => {
		const histogram = new Histogram({
			name: "histogram_buckets",
			help: "test",
			buckets: [1, 0.1, 1],
		});
		histogram.observe(0.05);

		const [value] = histogram.getValues();
		assert.deepEqual(Array.from(value.bucketValues.keys()), [0.1, 1]);
		assert.equal(value.bucketValues.get(0.1), 1);
	});

	it("rejects non-finite buckets", () => {
		assert.throws(
			() =>
				new Histogram({
					name: "histogram_inf",
					help: "test",
					buckets: [1, Number.POSITIVE_INFINITY],
				}),
			/Bucket is not a valid number/,
		);
	});
});

describe("registry default labels", () => {
	it("rejects invalid default label names", () => {
		assert.throws(
			() => new Registry({ defaultLabels: { "invalid label": "x" } }),
			/Invalid label name/,
		);
	});

	it("rejects reserved default label names", () => {
		for (const name of ["le", "quantile"]) {
			assert.throws(
				() => new Registry({ defaultLabels: { [name]: "x" } }),
				/reserved label keyword/,
			);
		}
	});
});
