import * as assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { Info } from "../src/metrics/info.ts";
import { globalRegistry } from "../src/registry.ts";

let instance: Info;

describe("info", () => {
	beforeEach(() => {
		globalRegistry.clear();
		instance = new Info({ name: "build", help: "test" });
	});

	it("should normalize info metric names with _info suffix", () => {
		assert.equal(instance.name, "build_info");
	});

	it("should keep names that already end with _info", () => {
		const preSuffixed = new Info({
			name: "runtime_info",
			help: "test",
		});
		assert.equal(preSuffixed.name, "runtime_info");
	});

	it("should set info labels", () => {
		instance.set({ version: "1.2.3", commit: "abc123" });
		assert.deepEqual(Array.from(instance.getValues()), [
			{
				labels: { version: "1.2.3", commit: "abc123" },
			},
		]);
	});

	it("should set labeled info labels", () => {
		const labeled = new Info({
			name: "build_labeled",
			help: "test",
			labelNames: ["service", "region"],
		});

		labeled.set(
			{ service: "api", region: "us-east-1" },
			{ version: "2.0.0", commit: "def456" },
		);
		labeled.set(
			{ service: "web", region: "eu-west-1" },
			{ version: "2.1.0", commit: "ghi789" },
		);

		assert.deepEqual(Array.from(labeled.getValues()), [
			{
				labels: {
					service: "api",
					region: "us-east-1",
					version: "2.0.0",
					commit: "def456",
				},
			},
			{
				labels: {
					service: "web",
					region: "eu-west-1",
					version: "2.1.0",
					commit: "ghi789",
				},
			},
		]);
	});

	it("should overwrite info for the same labels", () => {
		instance.set({ version: "1.0.0" });
		instance.set({ version: "1.1.0", commit: "abc123" });

		assert.deepEqual(Array.from(instance.getValues()), [
			{
				labels: { version: "1.1.0", commit: "abc123" },
			},
		]);
	});

	it("should reject info keys that overlap with label names", () => {
		const labeled = new Info({
			name: "build_overlap",
			help: "test",
			labelNames: ["service"],
		});

		assert.throws(
			() => labeled.set({ service: "api" }, { service: "duplicate" }),
			/Info name "service" cannot overlap with label name/,
		);
	});

	it("should provide withLabels helpers for set and reset", () => {
		const labeled = new Info({
			name: "build_with_labels",
			help: "test",
			labelNames: ["service"],
		});

		const apiInfo = labeled.withLabels({ service: "api" });
		const webInfo = labeled.withLabels({ service: "web" });

		apiInfo.set({ version: "1.0.0" });
		webInfo.set({ version: "2.0.0" });

		assert.deepEqual(Array.from(labeled.getValues()), [
			{ labels: { service: "api", version: "1.0.0" } },
			{ labels: { service: "web", version: "2.0.0" } },
		]);

		apiInfo.reset();

		assert.deepEqual(Array.from(labeled.getValues()), [
			{ labels: { service: "web", version: "2.0.0" } },
		]);
	});

	it("should reset info metrics", () => {
		instance.set({ version: "1.2.3" });
		instance.reset();
		assert.equal(Array.from(instance.getValues()).length, 0);
	});
});
