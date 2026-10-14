import * as assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { globalRegistry, Registry, Summary } from "../src/index.ts";
import { TDigest } from "../src/quantiles/tdigest.ts";
import { TimeWindowQuantiles } from "../src/quantiles/timeWindowQuantiles.ts";

let instance: Summary;

const getEntries = (summary: Summary) =>
	Array.from(summary.getValues(), ({ labels, sum, count }) => ({
		labels,
		sum,
		count,
	}));

describe("summary", () => {
	beforeEach(() => {
		globalRegistry.clear();
		instance = new Summary({ name: "summary_test", help: "test" });
	});

	afterEach(() => {
		mock.timers.reset();
	});

	it("should have a default value", () => {
		assert.deepEqual(getEntries(instance), [{ labels: {}, sum: 0, count: 0 }]);
	});

	it("should observe values", () => {
		instance.observe(1);
		instance.observe(2.5);
		instance.observe(0);

		assert.deepEqual(getEntries(instance), [
			{ labels: {}, sum: 3.5, count: 3 },
		]);
	});

	it("should observe negative values", () => {
		instance.observe(-4);
		instance.observe(1);

		assert.deepEqual(getEntries(instance), [{ labels: {}, sum: -3, count: 2 }]);
	});

	it("should support labeled observations", () => {
		const labeled = new Summary({
			name: "summary_labeled_test",
			help: "test",
			labelNames: ["method", "status"],
		});

		labeled.observe({ method: "GET", status: "200" }, 0.5);
		labeled.observe({ method: "GET", status: "200" }, 1.5);
		labeled.observe({ method: "POST", status: "500" }, 3);

		assert.deepEqual(getEntries(labeled), [
			{ labels: { method: "GET", status: "200" }, sum: 2, count: 2 },
			{ labels: { method: "POST", status: "500" }, sum: 3, count: 1 },
		]);
	});

	it("should provide withLabels helpers for observe, zero and reset", () => {
		const labeled = new Summary({
			name: "summary_with_labels_test",
			help: "test",
			labelNames: ["method"],
		});

		const getSummary = labeled.withLabels({ method: "GET" });
		const postSummary = labeled.withLabels({ method: "POST" });

		getSummary.observe(1);
		getSummary.observe(2);
		postSummary.observe(4);

		assert.deepEqual(getEntries(labeled), [
			{ labels: { method: "GET" }, sum: 3, count: 2 },
			{ labels: { method: "POST" }, sum: 4, count: 1 },
		]);

		getSummary.reset();
		assert.deepEqual(getEntries(labeled), [
			{ labels: { method: "POST" }, sum: 4, count: 1 },
		]);

		getSummary.zero();
		assert.deepEqual(getEntries(labeled), [
			{ labels: { method: "POST" }, sum: 4, count: 1 },
			{ labels: { method: "GET" }, sum: 0, count: 0 },
		]);
	});

	it("should initialize a label set with zero()", () => {
		const labeled = new Summary({
			name: "summary_zero_test",
			help: "test",
			labelNames: ["method"],
		});

		labeled.zero({ method: "GET" });
		assert.deepEqual(getEntries(labeled), [
			{ labels: { method: "GET" }, sum: 0, count: 0 },
		]);
	});

	it("should reset unlabeled summaries back to zero", () => {
		instance.observe(5);
		instance.reset();

		assert.deepEqual(getEntries(instance), [{ labels: {}, sum: 0, count: 0 }]);
	});

	it("should throw for invalid values without creating a series", () => {
		const labeled = new Summary({
			name: "summary_invalid_value_test",
			help: "test",
			labelNames: ["method"],
		});

		for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
			assert.throws(
				() => instance.observe(value),
				/Value is not a valid number/,
			);
			assert.throws(
				() => labeled.observe({ method: "GET" }, value),
				/Value is not a valid number/,
			);
		}

		assert.deepEqual(getEntries(instance), [{ labels: {}, sum: 0, count: 0 }]);
		assert.deepEqual(getEntries(labeled), []);
	});

	it("should time wrapped functions", () => {
		const timed = instance.time(() => "ok");
		assert.equal(timed(), "ok");

		const [value] = getEntries(instance);
		assert.equal(value.count, 1);
		assert.ok(value.sum > 0);
	});

	describe("configuration", () => {
		it("should reject quantile as a label name", () => {
			assert.throws(
				() =>
					new Summary({
						name: "summary_reserved_label_test",
						help: "test",
						labelNames: ["quantile"],
					}),
				/"quantile" is a reserved label keyword/,
			);
		});

		it("should reject invalid quantiles", () => {
			for (const quantile of [-0.1, 1.1, Number.NaN]) {
				assert.throws(
					() =>
						new Summary({
							name: "summary_invalid_quantile_test",
							help: "test",
							percentiles: [0.5, quantile],
						}),
					/must be between 0 and 1/,
				);
			}
		});

		it("should reject an invalid window", () => {
			for (const maxAgeSeconds of [
				0,
				-1,
				Number.NaN,
				Number.POSITIVE_INFINITY,
			]) {
				assert.throws(
					() =>
						new Summary({
							name: "summary_invalid_age_test",
							help: "test",
							percentiles: [0.5],
							maxAgeSeconds,
						}),
					/maxAgeSeconds/,
				);
			}
			for (const ageBuckets of [0, -1, 1.5, Number.NaN]) {
				assert.throws(
					() =>
						new Summary({
							name: "summary_invalid_buckets_test",
							help: "test",
							percentiles: [0.5],
							ageBuckets,
						}),
					/ageBuckets/,
				);
			}
		});

		it("should not register a summary with an invalid configuration", () => {
			assert.throws(
				() =>
					new Summary({
						name: "summary_not_registered_test",
						help: "test",
						percentiles: [2],
					}),
			);
			assert.doesNotThrow(
				() =>
					new Summary({ name: "summary_not_registered_test", help: "test" }),
			);
		});
	});

	describe("quantiles", () => {
		it("should sort quantiles and remove duplicates", () => {
			const summary = new Summary({
				name: "summary_sorted_quantiles_test",
				help: "test",
				percentiles: [0.99, 0.5, 0.5, 0.9],
			});
			summary.observe(1);
			const [entry] = summary.getValues();

			assert.deepEqual(
				summary.getQuantiles(entry).map(([q]) => q),
				[0.5, 0.9, 0.99],
			);
		});

		it("should estimate quantiles", () => {
			const summary = new Summary({
				name: "summary_estimate_test",
				help: "test",
				percentiles: [0, 0.5, 0.9, 0.99, 1],
			});
			for (let i = 1; i <= 1000; i++) summary.observe(i);
			const [entry] = summary.getValues();

			const estimates = new Map(summary.getQuantiles(entry));
			assert.equal(estimates.get(0), 1);
			assert.ok(Math.abs((estimates.get(0.5) ?? 0) - 500.5) <= 5);
			assert.ok(Math.abs((estimates.get(0.9) ?? 0) - 900.5) <= 5);
			assert.ok(Math.abs((estimates.get(0.99) ?? 0) - 990.5) <= 5);
			assert.equal(estimates.get(1), 1000);
		});

		it("should estimate quantiles per label set", () => {
			const labeled = new Summary({
				name: "summary_labeled_quantiles_test",
				help: "test",
				labelNames: ["method"],
				percentiles: [0.5],
			});
			for (let i = 0; i < 100; i++) {
				labeled.observe({ method: "GET" }, 1);
				labeled.observe({ method: "POST" }, 100);
			}

			const medians = Array.from(labeled.getValues(), (entry) => ({
				method: entry.labels.method,
				median: labeled.getQuantiles(entry)[0][1],
			}));
			assert.deepEqual(medians, [
				{ method: "GET", median: 1 },
				{ method: "POST", median: 100 },
			]);
		});

		it("should return NaN when there are no observations", () => {
			const summary = new Summary({
				name: "summary_empty_quantiles_test",
				help: "test",
				percentiles: [0.5, 0.99],
			});
			const [entry] = summary.getValues();
			const quantiles = summary.getQuantiles(entry);

			assert.deepEqual(
				quantiles.map(([q]) => q),
				[0.5, 0.99],
			);
			assert.ok(quantiles.every(([, value]) => Number.isNaN(value)));
		});

		it("should retain lifetime quantiles by default, including with only one age option", () => {
			mock.timers.enable({ apis: ["Date"], now: 0 });
			for (const [i, options] of [
				{},
				{ maxAgeSeconds: 60 },
				{ ageBuckets: 3 },
			].entries()) {
				const summary = new Summary({
					name: `summary_lifetime_test_${i}`,
					help: "test",
					percentiles: [0, 0.5, 1],
					pruneAgedBuckets: true,
					...options,
				});
				summary.observe(10);
				mock.timers.tick(365 * 24 * 60 * 60 * 1000);
				const [entry] = summary.getValues();
				assert.ok(entry.window instanceof TDigest);
				assert.equal(entry.window.count, 1);
				assert.deepEqual(summary.getQuantiles(entry), [
					[0, 10],
					[0.5, 10],
					[1, 10],
				]);
				summary.observe(30);
				assert.equal(entry.sum, 40);
				assert.equal(entry.count, 2);
				assert.equal(summary.getQuantiles(entry)[1][1], 20);

				summary.reset();
				summary.observe(50);
				const [resetEntry] = summary.getValues();
				assert.ok(resetEntry.window instanceof TDigest);
				assert.equal(resetEntry.count, 1);
				assert.equal(summary.getQuantiles(resetEntry)[1][1], 50);
			}
		});

		it("should only calculate quantiles over the sliding window, but keep sum and count", () => {
			mock.timers.enable({ apis: ["Date"], now: 0 });
			const summary = new Summary({
				name: "summary_window_test",
				help: "test",
				percentiles: [0.5],
				maxAgeSeconds: 100,
				ageBuckets: 4,
			});
			const [entry] = summary.getValues();
			assert.ok(entry.window instanceof TimeWindowQuantiles);

			summary.observe(10);
			mock.timers.tick(50_000);
			summary.observe(30);
			assert.equal(summary.getQuantiles(entry)[0][1], 20);

			// the first observation has aged out
			mock.timers.tick(50_000);
			assert.equal(summary.getQuantiles(entry)[0][1], 30);
			assert.equal(entry.sum, 40);
			assert.equal(entry.count, 2);

			// so has the second
			mock.timers.tick(50_000);
			assert.ok(Number.isNaN(summary.getQuantiles(entry)[0][1]));
			assert.equal(entry.sum, 40);
			assert.equal(entry.count, 2);
		});
	});

	describe("pruneAgedBuckets", () => {
		it("should not prune by default", () => {
			mock.timers.enable({ apis: ["Date"], now: 0 });
			const summary = new Summary({
				name: "summary_no_prune_test",
				help: "test",
				labelNames: ["method"],
				percentiles: [0.5],
				maxAgeSeconds: 100,
				ageBuckets: 4,
			});
			summary.observe({ method: "GET" }, 1);

			mock.timers.tick(100_000);
			assert.deepEqual(getEntries(summary), [
				{ labels: { method: "GET" }, sum: 1, count: 1 },
			]);
		});

		it("should prune series whose window has aged out", () => {
			mock.timers.enable({ apis: ["Date"], now: 0 });
			const summary = new Summary({
				name: "summary_prune_test",
				help: "test",
				labelNames: ["method"],
				percentiles: [0.5],
				maxAgeSeconds: 100,
				ageBuckets: 4,
				pruneAgedBuckets: true,
			});
			summary.observe({ method: "GET" }, 1);
			summary.observe({ method: "POST" }, 2);

			// the whole window has aged out
			mock.timers.tick(100_000);
			assert.deepEqual(getEntries(summary), []);

			// observing recreates the series
			summary.observe({ method: "GET" }, 3);
			assert.deepEqual(getEntries(summary), [
				{ labels: { method: "GET" }, sum: 3, count: 1 },
			]);
		});

		it("should keep series without percentiles", () => {
			mock.timers.enable({ apis: ["Date"], now: 0 });
			const summary = new Summary({
				name: "summary_prune_no_percentiles_test",
				help: "test",
				percentiles: [],
				pruneAgedBuckets: true,
			});
			summary.observe(1);

			mock.timers.tick(100_000);
			assert.deepEqual(getEntries(summary), [{ labels: {}, sum: 1, count: 1 }]);
		});
	});

	describe("registry", () => {
		it("should only expose sum and count without percentiles", async () => {
			const registry = new Registry();
			const summary = new Summary({
				name: "request_duration_seconds",
				help: "test",
				percentiles: [],
				registries: [registry],
			});
			summary.observe(1);
			summary.observe(2);

			assert.equal(
				await registry.getMetrics(),
				[
					"# HELP request_duration_seconds test",
					"# TYPE request_duration_seconds summary",
					"request_duration_seconds_sum 3",
					"request_duration_seconds_count 2",
					"",
				].join("\n"),
			);
		});

		it("should expose quantiles, sum and count", async () => {
			const registry = new Registry();
			const summary = new Summary({
				name: "request_duration_seconds",
				help: "test",
				percentiles: [0.99, 0.5],
				registries: [registry],
			});
			summary.observe(1);
			summary.observe(2);
			summary.observe(3);

			assert.equal(
				await registry.getMetrics(),
				[
					"# HELP request_duration_seconds test",
					"# TYPE request_duration_seconds summary",
					'request_duration_seconds{quantile="0.5"} 2',
					'request_duration_seconds{quantile="0.99"} 3',
					"request_duration_seconds_sum 6",
					"request_duration_seconds_count 3",
					"",
				].join("\n"),
			);
		});

		it("should expose labels and default labels", async () => {
			const registry = new Registry({ defaultLabels: { app: "api" } });
			const summary = new Summary({
				name: "request_duration_seconds",
				help: "test",
				labelNames: ["method"],
				percentiles: [0.5],
				registries: [registry],
			});
			summary.observe({ method: "GET" }, 1);
			summary.observe({ method: "POST" }, 5);

			assert.equal(
				await registry.getMetrics(),
				[
					"# HELP request_duration_seconds test",
					"# TYPE request_duration_seconds summary",
					'request_duration_seconds{quantile="0.5",app="api",method="GET"} 1',
					'request_duration_seconds_sum{app="api",method="GET"} 1',
					'request_duration_seconds_count{app="api",method="GET"} 1',
					'request_duration_seconds{quantile="0.5",app="api",method="POST"} 5',
					'request_duration_seconds_sum{app="api",method="POST"} 5',
					'request_duration_seconds_count{app="api",method="POST"} 1',
					"",
				].join("\n"),
			);
		});

		it("should expose NaN quantiles when the window is empty", async () => {
			const registry = new Registry();
			new Summary({
				name: "request_duration_seconds",
				help: "test",
				percentiles: [0.5],
				registries: [registry],
			});

			assert.equal(
				await registry.getMetrics(),
				[
					"# HELP request_duration_seconds test",
					"# TYPE request_duration_seconds summary",
					'request_duration_seconds{quantile="0.5"} NaN',
					"request_duration_seconds_sum 0",
					"request_duration_seconds_count 0",
					"",
				].join("\n"),
			);
		});

		it("should prune aged series from the output", async () => {
			mock.timers.enable({ apis: ["Date"], now: 0 });
			const registry = new Registry();
			const summary = new Summary({
				name: "request_duration_seconds",
				help: "test",
				percentiles: [0.5],
				maxAgeSeconds: 100,
				ageBuckets: 4,
				pruneAgedBuckets: true,
				registries: [registry],
			});
			summary.observe(1);

			// the whole window has aged out
			mock.timers.tick(100_000);
			assert.equal(await registry.getMetrics(), "");
		});

		it("should expose summaries in the OpenMetrics format", async () => {
			const registry = new Registry({ contentType: "OpenMetricsV1" });
			const summary = new Summary({
				name: "request_duration",
				unit: "seconds",
				help: "test",
				percentiles: [0.5],
				registries: [registry],
			});
			summary.observe(2);

			assert.equal(
				await registry.getMetrics(),
				[
					"# HELP request_duration_seconds test",
					"# UNIT request_duration_seconds seconds",
					"# TYPE request_duration_seconds summary",
					'request_duration_seconds{quantile="0.5"} 2',
					"request_duration_seconds_sum 2",
					"request_duration_seconds_count 1",
					"# EOF",
					"",
				].join("\n"),
			);
		});
	});
});
