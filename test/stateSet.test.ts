import * as assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { StateSet } from "../src/metrics/stateSet.ts";
import { globalRegistry } from "../src/registry.ts";

let instance: StateSet;

describe("stateSet", () => {
	beforeEach(() => {
		globalRegistry.clear();
		instance = new StateSet({
			name: "service_state",
			help: "test",
			states: ["starting", "ready", "failed"],
		});
	});

	it("should have default false values for all configured states", () => {
		assert.deepEqual(Array.from(instance.getValues()), [
			{
				labels: {},
				states: {
					starting: false,
					ready: false,
					failed: false,
				},
			},
		]);
	});

	it("should set and merge state values", () => {
		instance.set({ starting: true });
		instance.set({ ready: true });

		assert.deepEqual(Array.from(instance.getValues()), [
			{
				labels: {},
				states: {
					starting: true,
					ready: true,
					failed: false,
				},
			},
		]);
	});

	it("should support labeled state values", () => {
		const labeled = new StateSet({
			name: "service_state_labeled",
			help: "test",
			labelNames: ["service", "region"],
			states: ["starting", "ready", "failed"],
		});

		labeled.set({ service: "api", region: "us-east-1" }, { starting: true });
		labeled.set({ service: "api", region: "us-east-1" }, { ready: true });
		labeled.set({ service: "web", region: "eu-west-1" }, { failed: true });

		assert.deepEqual(Array.from(labeled.getValues()), [
			{
				labels: { service: "api", region: "us-east-1" },
				states: {
					starting: true,
					ready: true,
					failed: false,
				},
			},
			{
				labels: { service: "web", region: "eu-west-1" },
				states: {
					starting: false,
					ready: false,
					failed: true,
				},
			},
		]);
	});

	it("should provide withLabels helpers for set and reset", () => {
		const labeled = new StateSet({
			name: "service_state_with_labels",
			help: "test",
			labelNames: ["service"],
			states: ["starting", "ready", "failed"],
		});

		const apiSet = labeled.withLabels({ service: "api" });
		const webSet = labeled.withLabels({ service: "web" });

		apiSet.set({ ready: true });
		webSet.set({ failed: true });

		assert.deepEqual(Array.from(labeled.getValues()), [
			{
				labels: { service: "api" },
				states: {
					starting: false,
					ready: true,
					failed: false,
				},
			},
			{
				labels: { service: "web" },
				states: {
					starting: false,
					ready: false,
					failed: true,
				},
			},
		]);

		apiSet.reset();

		assert.deepEqual(Array.from(labeled.getValues()), [
			{
				labels: { service: "web" },
				states: {
					starting: false,
					ready: false,
					failed: true,
				},
			},
		]);
	});

	it("should initialize a label set with zero()", () => {
		const labeled = new StateSet({
			name: "service_state_zero",
			help: "test",
			labelNames: ["service"],
			states: ["starting", "ready", "failed"],
		});

		labeled.zero({ service: "api" });

		assert.deepEqual(Array.from(labeled.getValues()), [
			{
				labels: { service: "api" },
				states: {
					starting: false,
					ready: false,
					failed: false,
				},
			},
		]);
	});

	it("should reset unlabeled state sets to all false", () => {
		instance.set({ starting: true, ready: true, failed: true });
		instance.reset();

		assert.deepEqual(Array.from(instance.getValues()), [
			{
				labels: {},
				states: {
					starting: false,
					ready: false,
					failed: false,
				},
			},
		]);
	});

	it("should reject label names that match the metric name", () => {
		assert.throws(
			() =>
				new StateSet({
					name: "service_state_conflict",
					help: "test",
					labelNames: ["service_state_conflict"],
					states: ["ready"],
				}),
			/Label name service_state_conflict cannot be the same as the metric name/,
		);
	});
});
