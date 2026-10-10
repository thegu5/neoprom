import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hashLabels } from "../src/utils.ts";

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
