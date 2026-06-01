import * as assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { Counter, globalRegistry } from "../src/index.ts";

let instance: Counter;

describe("counter", () => {
	beforeEach(() => {
		globalRegistry.clear();
		instance = new Counter({ name: "counter_test", help: "test" });
	});

	it("should normalize counter metric names with _total suffix", () => {
		assert.equal(instance.name, "counter_test_total");
	});

	it("should keep names that already end with _total", () => {
		const preSuffixed = new Counter({
			name: "requests_total",
			help: "test",
		});
		assert.equal(preSuffixed.name, "requests_total");
	});

	it("should have a default value", () => {
		assert.equal(Array.from(instance.getValues())[0].value, 0);
	});

	it("should increment counter", () => {
		instance.inc();
		assert.equal(Array.from(instance.getValues())[0].value, 1);
		instance.inc();
		assert.equal(Array.from(instance.getValues())[0].value, 2);
		instance.inc(0);
		assert.equal(Array.from(instance.getValues())[0].value, 2);
	});

	it("should throw when incrementing with a negative value", () => {
		assert.throws(() => instance.inc(-1), /counter cannot decrease/);
	});

	it("should increment counter with labels", () => {
		const labeled = new Counter({
			name: "counter_labeled_test",
			help: "test",
			labelNames: ["method", "status"],
		});

		labeled.inc({ method: "GET", status: "200" });
		labeled.inc({ method: "GET", status: "200" }, 2);
		labeled.inc({ method: "POST", status: "500" }, 3);

		assert.deepEqual(Array.from(labeled.getValues()), [
			{ labels: { method: "GET", status: "200" }, value: 3 },
			{ labels: { method: "POST", status: "500" }, value: 3 },
		]);
	});

	it("should provide withLabels helpers for increment and reset", () => {
		const labeled = new Counter({
			name: "counter_with_labels_test",
			help: "test",
			labelNames: ["method"],
		});

		const getCounter = labeled.withLabels({ method: "GET" });
		const postCounter = labeled.withLabels({ method: "POST" });

		getCounter.inc();
		getCounter.inc(2);
		postCounter.inc(4);

		assert.deepEqual(Array.from(labeled.getValues()), [
			{ labels: { method: "GET" }, value: 3 },
			{ labels: { method: "POST" }, value: 4 },
		]);

		getCounter.reset();

		assert.deepEqual(Array.from(labeled.getValues()), [
			{ labels: { method: "POST" }, value: 4 },
		]);
	});

	it("should reset unlabeled counters back to zero", () => {
		instance.inc(5);
		instance.reset();

		assert.deepEqual(Array.from(instance.getValues()), [
			{ labels: {}, value: 0 },
		]);
	});
});
