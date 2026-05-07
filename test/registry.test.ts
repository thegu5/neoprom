import { describe, it } from "node:test";
import { Counter } from "../src/counter.ts";
import { Histogram } from "../src/histogram.ts";
import { Registry } from "../src/registry.ts";

// none of these are actual tests yet, need to do assertions
describe("Registry", () => {
	it("works? (temporary test)", async () => {
		const registry = new Registry("Prometheus");
		const testCounter = new Counter({
			name: `test
            Counter`,
			help: "yup",
			labelNames: ["f oo"],
		});
		registry.register(testCounter);
		testCounter.inc();
		testCounter.inc({ "f oo": "bar" }, 2);
		console.log(await registry.getMetrics());
	});
	it("does histogram stuff", async () => {
		const registry = new Registry("Prometheus");
		const testHistogram = new Histogram({
			name: "a_histogram",
			help: ":)",
			labelNames: ["foo", "bar"],
		});
		registry.register(testHistogram);
		testHistogram.observe({ foo: "asdf" }, 0.01);
		testHistogram.observe(10);
		testHistogram.observe({ foo: "asdf", bar: "awawa" }, 5);
		testHistogram.observe(0.1);
		testHistogram.observe(0.5);
		console.log(await registry.getMetrics());
	});
});
