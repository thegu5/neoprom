import * as assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { Gauge, globalRegistry } from "../src/index.ts";

let instance: Gauge;

describe("gauge", () => {
	beforeEach(() => {
		globalRegistry.clear();
		instance = new Gauge({ name: "gauge_test", help: "test" });
	});

	it("should have a default value", () => {
		assert.equal(Array.from(instance.getValues())[0].value, 0);
	});

	it("should increment and decrement gauge", () => {
		instance.inc();
		assert.equal(Array.from(instance.getValues())[0].value, 1);
		instance.inc(2);
		assert.equal(Array.from(instance.getValues())[0].value, 3);
		instance.dec();
		assert.equal(Array.from(instance.getValues())[0].value, 2);
		instance.dec(2);
		assert.equal(Array.from(instance.getValues())[0].value, 0);
	});

	it("should set gauge value", () => {
		instance.inc(10);
		instance.set(3);
		assert.equal(Array.from(instance.getValues())[0].value, 3);
	});

	it("should support labeled gauge values", () => {
		const labeled = new Gauge({
			name: "gauge_labeled_test",
			help: "test",
			labelNames: ["method", "status"],
		});

		labeled.inc({ method: "GET", status: "200" });
		labeled.inc({ method: "GET", status: "200" }, 2);
		labeled.dec({ method: "GET", status: "200" });
		labeled.set({ method: "POST", status: "500" }, 4);

		assert.deepEqual(Array.from(labeled.getValues()), [
			{ labels: { method: "GET", status: "200" }, value: 2 },
			{ labels: { method: "POST", status: "500" }, value: 4 },
		]);
	});

	it("should provide withLabels helpers for increment, decrement, and reset", () => {
		const labeled = new Gauge({
			name: "gauge_with_labels_test",
			help: "test",
			labelNames: ["method"],
		});

		const getGauge = labeled.withLabels({ method: "GET" });
		const postGauge = labeled.withLabels({ method: "POST" });

		getGauge.inc();
		getGauge.inc(2);
		getGauge.dec();
		postGauge.inc(4);

		assert.deepEqual(Array.from(labeled.getValues()), [
			{ labels: { method: "GET" }, value: 2 },
			{ labels: { method: "POST" }, value: 4 },
		]);

		getGauge.reset();

		assert.deepEqual(Array.from(labeled.getValues()), [
			{ labels: { method: "POST" }, value: 4 },
		]);
	});

	it("should reset unlabeled gauges back to zero", () => {
		instance.inc(5);
		instance.reset();

		assert.deepEqual(Array.from(instance.getValues()), [
			{ labels: {}, value: 0 },
		]);
	});

	it("should time wrapped functions", () => {
		const timed = instance.time(() => "ok");
		assert.equal(timed(), "ok");
		assert.ok(Array.from(instance.getValues())[0].value > 0);
	});

	it("should increment in-progress gauge during wrapped execution and decrement after", () => {
		const wrapped = instance.trackInProgress(() => {
			assert.equal(Array.from(instance.getValues())[0].value, 1);
			return "done";
		});

		assert.equal(wrapped(), "done");
		assert.equal(Array.from(instance.getValues())[0].value, 0);
	});

	it("should decrement in-progress gauge when wrapped function throws", () => {
		const wrapped = instance.trackInProgress(() => {
			throw new Error("boom");
		});

		assert.throws(wrapped, /boom/);
		assert.equal(Array.from(instance.getValues())[0].value, 0);
	});
});
