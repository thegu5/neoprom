import * as assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { globalRegistry, Histogram } from "../src/index.ts";

let instance: Histogram;

describe("histogram", () => {
	beforeEach(() => {
		globalRegistry.clear();
		instance = new Histogram({ name: "histogram_test", help: "test" });
	});

	it("should have a default value", () => {
		const value = Array.from(instance.getValues())[0];
		assert.equal(value.sum, 0);
		assert.equal(value.count, 0);
		assert.deepEqual(value.labels, {});
		assert.equal(
			Object.values(value.bucketValues).every((count) => count === 0),
			true,
		);
	});

	it("should observe values", () => {
		instance.observe(0.1);
		instance.observe(10);

		const value = Array.from(instance.getValues())[0];
		assert.equal(value.sum, 10.1);
		assert.equal(value.count, 2);
		assert.equal(value.bucketValues[0.1], 1);
		assert.equal(value.bucketValues[10], 1);
	});

	it("should support labeled observations", () => {
		const labeled = new Histogram({
			name: "histogram_labeled_test",
			help: "test",
			labelNames: ["method", "status"],
		});

		labeled.observe({ method: "GET", status: "200" }, 0.05);
		labeled.observe({ method: "GET", status: "200" }, 0.25);
		labeled.observe({ method: "POST", status: "500" }, 5);

		assert.deepEqual(Array.from(labeled.getValues()), [
			{
				sum: 0.3,
				count: 2,
				labels: { method: "GET", status: "200" },
				bucketValues: {
					0.005: 0,
					0.01: 0,
					0.025: 0,
					0.05: 1,
					0.1: 0,
					0.25: 1,
					0.5: 0,
					1: 0,
					2.5: 0,
					5: 0,
					10: 0,
				},
			},
			{
				sum: 5,
				count: 1,
				labels: { method: "POST", status: "500" },
				bucketValues: {
					0.005: 0,
					0.01: 0,
					0.025: 0,
					0.05: 0,
					0.1: 0,
					0.25: 0,
					0.5: 0,
					1: 0,
					2.5: 0,
					5: 1,
					10: 0,
				},
			},
		]);
	});

	it("should provide withLabels helpers for observe and reset", () => {
		const labeled = new Histogram({
			name: "histogram_with_labels_test",
			help: "test",
			labelNames: ["method"],
		});

		const getHistogram = labeled.withLabels({ method: "GET" });
		const postHistogram = labeled.withLabels({ method: "POST" });

		getHistogram.observe(0.1);
		getHistogram.observe(0.5);
		postHistogram.observe(5);

		assert.equal(Array.from(labeled.getValues()).length, 2);
		getHistogram.reset();
		assert.deepEqual(Array.from(labeled.getValues()), [
			{
				sum: 5,
				count: 1,
				labels: { method: "POST" },
				bucketValues: {
					0.005: 0,
					0.01: 0,
					0.025: 0,
					0.05: 0,
					0.1: 0,
					0.25: 0,
					0.5: 0,
					1: 0,
					2.5: 0,
					5: 1,
					10: 0,
				},
			},
		]);
	});

	it("should reset unlabeled histograms back to zero values", () => {
		instance.observe(1);
		instance.reset();

		const value = Array.from(instance.getValues())[0];
		assert.equal(value.sum, 0);
		assert.equal(value.count, 0);
		assert.deepEqual(value.labels, {});
		assert.equal(
			Object.values(value.bucketValues).every((count) => count === 0),
			true,
		);
	});

	it("should throw for invalid values", () => {
		assert.throws(
			() => instance.observe(Number.NaN),
			/Value is not a valid number/,
		);
		assert.throws(
			() => instance.observe(Number.POSITIVE_INFINITY),
			/Value is not a valid number/,
		);
	});

	it("should time wrapped functions", () => {
		const timed = instance.time(() => "ok");
		assert.equal(timed(), "ok");

		const value = Array.from(instance.getValues())[0];
		assert.equal(value.count, 1);
		assert.ok(value.sum > 0);
	});

	it("should throw when using reserved le label name", () => {
		assert.throws(
			() =>
				new Histogram({
					name: "histogram_reserved_label_test",
					help: "test",
					labelNames: ["le"],
				}),
			/le is a reserved label keyword/,
		);
	});
});
