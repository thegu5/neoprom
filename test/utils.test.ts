import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHook, hashLabels, type LabelObject } from "../src/utils.ts";

describe("createHook", () => {
	it("should preserve parameters, return types, and this with or without labels", () => {
		const events: (LabelObject<"method"> | string)[] = [];
		const hook = createHook<"method">((labels) => {
			events.push(labels);
			return () => events.push("end");
		});
		function target(this: { prefix: string }, value: number): string {
			events.push("target");
			return `${this.prefix}${value}`;
		}

		const wrapped: typeof target = hook(target);
		const labeled: typeof target = hook({ method: "test" }, target);

		assert.equal(wrapped.call({ prefix: "value: " }, 42), "value: 42");
		assert.equal(labeled.call({ prefix: "value: " }, 7), "value: 7");
		assert.deepEqual(events, [
			{},
			"target",
			"end",
			{ method: "test" },
			"target",
			"end",
		]);
	});

	it("should preserve generic function signatures", () => {
		const hook = createHook<"method">(() => () => {});
		const identity = <T>(value: T): T => value;
		const wrapped = hook(identity);
		const labeled = hook({ method: "identity" }, identity);

		const number: number = wrapped(42);
		const string: string = labeled("hello");
		assert.equal(number, 42);
		assert.equal(string, "hello");
	});

	it("should preserve overloaded function signatures", () => {
		const hook = createHook<"method">(() => () => {});
		function identity(value: number): number;
		function identity(value: string): string;
		function identity(value: number | string) {
			return value;
		}
		const wrapped = hook(identity);
		const labeled = hook({ method: "identity" }, identity);

		const number: number = wrapped(42);
		const string: string = wrapped("hello");
		const labeledNumber: number = labeled(7);
		const labeledString: string = labeled("world");
		assert.equal(number, 42);
		assert.equal(string, "hello");
		assert.equal(labeledNumber, 7);
		assert.equal(labeledString, "world");
	});
});

describe("hashLabels", () => {
	it("should produce the same hash regardless of property order", () => {
		assert.equal(
			hashLabels({ method: "GET", status: "200" }),
			hashLabels({ status: "200", method: "GET" }),
		);
	});

	it("should filter out undefined and empty values", () => {
		assert.equal(hashLabels({ a: undefined, b: "", c: "x" }), "c:x");
	});

	it("should return an empty string for no labels", () => {
		assert.equal(hashLabels({}), "");
	});
});
