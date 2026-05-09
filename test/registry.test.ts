import { beforeEach, describe, it } from "node:test";
import { Counter } from "../src/counter.ts";
import { Histogram } from "../src/histogram.ts";
import { globalRegistry } from "../src/registry.ts";

// none of these are actual tests yet, need to do assertions
describe("Registry", () => {
	beforeEach(() => {
		globalRegistry.clear();
	});
	it("works? (temporary test)", async () => {
		const testCounter = new Counter({
			name: `test
            Counter`,
			help: "yup",
			labelNames: ["f oo"],
		});
		testCounter.inc();
		testCounter.inc({ "f oo": "bar" }, 2);
		console.log(await globalRegistry.getMetrics());
	});
	it("does histogram stuff", async () => {
		const testHistogram = new Histogram({
			name: "a_histogram",
			help: ":)",
			labelNames: ["foo", "bar"],
		});
		testHistogram.observe({ foo: "asdf" }, 0.01);
		testHistogram.observe(10);
		testHistogram.observe({ foo: "asdf", bar: "awawa" }, 5);
		testHistogram.observe(0.1);
		testHistogram.observe(0.5);
		console.log(await globalRegistry.getMetrics());
	});
});
