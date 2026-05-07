import { describe, it } from "node:test";
import { Counter } from "../src/counter.ts";
import { Registry } from "../src/registry.ts";

describe("Registry", () => {
	it("works? (temporary test)", async () => {
		const registry = new Registry("Prometheus");
        const testCounter = new Counter({ name: `test
            Counter`, help: "yup", labelNames: ["f oo"] })
		registry.register(testCounter);
        testCounter.inc();
        testCounter.inc({ "f oo": "bar" }, 2);
        console.log(await registry.getMetrics())
	});
});
