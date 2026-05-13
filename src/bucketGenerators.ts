// using node:assert/strict would make sense
// TODO: check runtime support

// TODO: double-check "Count MUST include the +Inf bucket"
// https://prometheus.io/docs/instrumenting/writing_clientlibs/#histogram

/**
 * Create an array with equal spacing between the elements.
 * @param start The first value in the array
 * @param width The spacing between the elements
 * @param count The number of items in array
 * @returns An array with the requested number of elements
 */
// @__NO_SIDE_EFFECTS__
export function linearBuckets(start: number, width: number, count: number) {
	// assert(count >= 1, "Linear buckets needs a positive count");
	if (count < 1) {
		throw new Error("Linear buckets needs a positive count");
	}

	return Array.from({ length: count }, (_, i) => start + i * width);
}

/**
 * Create an array that grows exponentially.
 * @param start The first value in the array
 * @param factor The exponential factor
 * @param count The number of items in array
 * @returns An array with the requested number of elements
 */
// @__NO_SIDE_EFFECTS__
export function exponentialBuckets(
	start: number,
	factor: number,
	count: number,
) {
	// assert(start > 0, "Exponential buckets needs a positive start");
	// assert(count >= 1, "Exponential buckets needs a positive count");
	// assert(factor > 1, "Exponential buckets needs a factor greater than 1");
	if (start <= 0) {
		throw new Error("Exponential buckets needs a positive start");
	}
	if (count < 1) {
		throw new Error("Exponential buckets needs a positive count");
	}
	if (factor <= 1) {
		throw new Error("Exponential buckets needs a factor greater than 1");
	}
	return Array.from({ length: count }, (_, i) => start * factor ** i);
}
