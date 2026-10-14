import * as assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { TimeWindowQuantiles } from "../src/quantiles/timeWindowQuantiles.ts";

const START = 100_000_000;

let window: TimeWindowQuantiles;

describe("timeWindowQuantiles", () => {
	beforeEach(() => {
		mock.timers.enable({ apis: ["Date"], now: START });
		// 60 seconds, in 3 buckets of 20 seconds
		window = new TimeWindowQuantiles(60, 3);
	});

	afterEach(() => {
		mock.timers.reset();
	});

	it("should be empty by default", () => {
		assert.equal(window.count, 0);
		assert.ok(Number.isNaN(window.quantiles([0.5])[0]));
	});

	it("should estimate quantiles of what was observed", () => {
		for (let i = 1; i <= 100; i++) window.observe(i);

		assert.equal(window.count, 100);
		const [min, median, max] = window.quantiles([0, 0.5, 1]);
		assert.equal(min, 1);
		assert.equal(median, 50.5);
		assert.equal(max, 100);
	});

	it("should forget observations once they are older than the window", () => {
		window.observe(1);

		mock.timers.tick(59_999);
		assert.equal(window.count, 1);

		mock.timers.tick(1);
		assert.equal(window.count, 0);
		assert.ok(Number.isNaN(window.quantiles([0.5])[0]));
	});

	it("should slide one bucket at a time", () => {
		window.observe(1);
		mock.timers.tick(20_000);
		window.observe(2);
		mock.timers.tick(20_000);
		window.observe(3);
		assert.equal(window.count, 3);

		// the first bucket ages out
		mock.timers.tick(20_000);
		assert.equal(window.count, 2);
		assert.equal(window.quantiles([0])[0], 2);

		mock.timers.tick(20_000);
		assert.equal(window.count, 1);
		assert.equal(window.quantiles([0])[0], 3);

		mock.timers.tick(20_000);
		assert.equal(window.count, 0);
	});

	it("should estimate quantiles across buckets", () => {
		window.observe(1);
		mock.timers.tick(40_000);
		window.observe(3);

		assert.equal(window.count, 2);
		assert.deepEqual(window.quantiles([0, 0.5, 1]), [1, 2, 3]);
	});

	it("should retain tied-data accuracy across populated buckets and repeated reads", () => {
		for (let bucket = 0; bucket < 3; bucket++) {
			for (let i = 0; i < 20_000; i++) window.observe(i % 100 < 50 ? 0 : 100);
			if (bucket < 2) mock.timers.tick(20_000);
		}
		const quantiles = [0, 0.1, 0.4, 0.6, 0.9, 1];
		const expected = [0, 0, 0, 100, 100, 100];
		for (let read = 0; read < 10; read++) {
			assert.deepEqual(window.quantiles(quantiles), expected);
			assert.equal(window.count, 60_000);
		}
		mock.timers.tick(20_000);
		assert.equal(window.count, 40_000);
		assert.deepEqual(window.quantiles(quantiles), expected);
	});

	it("should forget everything after being idle for longer than the window", () => {
		window.observe(1);
		window.observe(2);
		mock.timers.tick(60 * 60 * 1000);
		assert.equal(window.count, 0);

		window.observe(10);
		assert.equal(window.count, 1);
		assert.equal(window.quantiles([0.5])[0], 10);

		// and the window keeps working afterwards
		mock.timers.tick(59_999);
		assert.equal(window.count, 1);
		mock.timers.tick(20_000);
		assert.equal(window.count, 0);
	});

	it("should not walk through every missed bucket after a long idle", () => {
		// a one second window of 1ms buckets, idle for a day
		const fine = new TimeWindowQuantiles(1, 1000);
		fine.observe(1);
		mock.timers.tick(24 * 60 * 60 * 1000);

		const start = performance.now();
		assert.equal(fine.count, 0);
		fine.observe(2);
		assert.equal(fine.count, 1);
		assert.ok(performance.now() - start < 250, "rotation was too slow");
	});

	it("should keep a bucket's observations until the whole bucket has aged out", () => {
		// observed late in its bucket; the observation lives until its bucket is reused
		mock.timers.tick(19_000);
		window.observe(1);

		mock.timers.tick(40_999);
		assert.equal(window.count, 1);
		mock.timers.tick(1);
		assert.equal(window.count, 0);
	});

	it("should recover when the clock goes backwards", () => {
		window.observe(1);

		mock.timers.setTime(START - 60 * 60 * 1000);
		window.observe(2);
		assert.equal(window.count, 2);

		// without handling this, nothing would expire for another hour
		mock.timers.tick(60_000);
		assert.equal(window.count, 0);
	});

	it("should work with a single bucket", () => {
		const single = new TimeWindowQuantiles(10, 1);
		single.observe(5);
		mock.timers.tick(9_999);
		assert.equal(single.count, 1);
		mock.timers.tick(1);
		assert.equal(single.count, 0);
	});

	it("should handle a lot of observations over time", () => {
		// 5 minutes of 100 observations per second, with a window of 1 minute
		const busy = new TimeWindowQuantiles(60, 6);
		for (let second = 0; second < 300; second++) {
			for (let i = 0; i < 100; i++) busy.observe(second);
			mock.timers.tick(1_000);
		}

		// the oldest bucket has just been dropped: between 50 and 60 seconds remain
		assert.ok(busy.count >= 50 * 100 && busy.count <= 60 * 100);
		const [min] = busy.quantiles([0]);
		assert.ok(min >= 240 && min <= 250, `min was ${min}`);
	});
});
