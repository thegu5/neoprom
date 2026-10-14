import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TDigest } from "../src/quantiles/tdigest.ts";

// deterministic pseudo-random numbers, so these tests never flake
function mulberry32(seed: number) {
	let a = seed;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function distributions(seed: number) {
	const random = mulberry32(seed);
	const normal = () =>
		Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
	return {
		random,
		uniform: () => random(),
		normal,
		lognormal: () => Math.exp(normal()),
		exponential: () => -Math.log(1 - random()),
	};
}

function lowerBound(sorted: Float64Array, value: number) {
	let lo = 0;
	let hi = sorted.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (sorted[mid] < value) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

function upperBound(sorted: Float64Array, value: number) {
	let lo = 0;
	let hi = sorted.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (sorted[mid] <= value) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

/**
 * How far `q` is from the true rank of `estimate` within the data: 0 if `estimate` is
 * a correct answer for `q`, otherwise the distance to the closest correct rank.
 */
function rankError(sorted: Float64Array, estimate: number, q: number) {
	assert.ok(
		Number.isFinite(estimate),
		`non-finite estimate ${estimate} at q=${q}`,
	);
	const low = lowerBound(sorted, estimate) / sorted.length;
	const high = upperBound(sorted, estimate) / sorted.length;
	if (q >= low && q <= high) return 0;
	return Math.min(Math.abs(q - low), Math.abs(q - high));
}

const MIDDLE_QUANTILES = [0.1, 0.25, 0.5, 0.75, 0.9];
const TAIL_QUANTILES = [0.001, 0.01, 0.99, 0.999];

// the usual summary objectives are {0.5: 0.05, 0.9: 0.01, 0.99: 0.001}
const MAX_MIDDLE_ERROR = 0.005;
const MAX_TAIL_ERROR = 0.001;

function assertAccurate(digest: TDigest, data: Float64Array) {
	const sorted = data.slice().sort();
	for (const q of MIDDLE_QUANTILES) {
		const error = rankError(sorted, digest.quantile(q), q);
		assert.ok(error <= MAX_MIDDLE_ERROR, `rank error ${error} at q=${q}`);
	}
	for (const q of TAIL_QUANTILES) {
		const error = rankError(sorted, digest.quantile(q), q);
		assert.ok(error <= MAX_TAIL_ERROR, `rank error ${error} at q=${q}`);
	}
}

function fill(digest: TDigest, count: number, next: () => number) {
	const data = new Float64Array(count);
	for (let i = 0; i < count; i++) {
		data[i] = next();
		digest.observe(data[i]);
	}
	return data;
}

describe("tdigest", () => {
	it("should be empty by default", () => {
		const digest = new TDigest();
		assert.equal(digest.count, 0);
		assert.equal(digest.centroidCount, 0);
		assert.ok(Number.isNaN(digest.quantile(0.5)));
	});

	it("should return the only value for every quantile", () => {
		const digest = new TDigest();
		digest.observe(42);
		assert.equal(digest.count, 1);
		for (const q of [0, 0.25, 0.5, 0.99, 1]) {
			assert.equal(digest.quantile(q), 42);
		}
	});

	it("should be exact for small amounts of data", () => {
		const digest = new TDigest();
		for (let i = 10; i >= 1; i--) digest.observe(i);

		assert.equal(digest.centroidCount, 10);
		assert.equal(digest.quantile(0), 1);
		assert.equal(digest.quantile(0.25), 3);
		assert.equal(digest.quantile(0.5), 5.5);
		assert.equal(digest.quantile(0.75), 8);
		assert.equal(digest.quantile(1), 10);
	});

	it("should handle negative values", () => {
		const digest = new TDigest();
		for (const value of [-5, -1, -3]) digest.observe(value);
		assert.equal(digest.quantile(0), -5);
		assert.equal(digest.quantile(0.5), -3);
		assert.equal(digest.quantile(1), -1);
	});

	it("should reject values that are not finite numbers", () => {
		const digest = new TDigest();
		for (const value of [
			Number.NaN,
			Number.POSITIVE_INFINITY,
			Number.NEGATIVE_INFINITY,
		]) {
			assert.throws(() => digest.observe(value), /Value is not a valid number/);
		}
		assert.equal(digest.count, 0);
	});

	it("should reject quantiles outside of 0 to 1", () => {
		const digest = new TDigest();
		digest.observe(1);
		for (const q of [-0.1, 1.1, Number.NaN]) {
			assert.throws(() => digest.quantile(q), /between 0 and 1/);
		}
	});

	it("should reject invalid compression", () => {
		for (const compression of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
			assert.throws(() => new TDigest(compression), /compression/);
		}
	});

	it("should track the minimum and maximum exactly", () => {
		const digest = new TDigest();
		const data = fill(digest, 50_000, distributions(1).lognormal);

		assert.equal(digest.min, Math.min(...data));
		assert.equal(digest.max, Math.max(...data));
		assert.equal(digest.quantile(0), digest.min);
		assert.equal(digest.quantile(1), digest.max);
	});

	it("should be monotonic", () => {
		const digest = new TDigest();
		fill(digest, 20_000, distributions(2).lognormal);

		let previous = Number.NEGATIVE_INFINITY;
		for (let i = 0; i <= 1000; i++) {
			const value = digest.quantile(i / 1000);
			assert.ok(value >= previous, `not monotonic at q=${i / 1000}`);
			previous = value;
		}
	});

	for (const name of [
		"uniform",
		"normal",
		"lognormal",
		"exponential",
	] as const) {
		it(`should estimate quantiles accurately for ${name} data`, () => {
			const digest = new TDigest();
			const data = fill(digest, 100_000, distributions(3)[name]);
			assertAccurate(digest, data);
		});
	}

	it("should estimate quantiles accurately for sorted input", () => {
		const ascending = new TDigest();
		const descending = new TDigest();
		const data = new Float64Array(100_000);
		for (let i = 0; i < data.length; i++) {
			data[i] = i;
			ascending.observe(i);
			descending.observe(data.length - 1 - i);
		}
		assertAccurate(ascending, data);
		assertAccurate(descending, data);
	});

	it("should stay small no matter how many values are added", () => {
		const digest = new TDigest();
		const { lognormal } = distributions(4);
		for (let i = 0; i < 1_000_000; i++) digest.observe(lognormal());
		assert.equal(digest.count, 1_000_000);
		assert.ok(digest.centroidCount < 300, `${digest.centroidCount} centroids`);
	});

	it("should handle many identical values", () => {
		const digest = new TDigest();
		for (let i = 0; i < 10_000; i++) digest.observe(7);
		for (const q of [0, 0.01, 0.5, 0.99, 1]) {
			assert.equal(digest.quantile(q), 7);
		}
		assert.ok(digest.centroidCount < 300);
	});

	it("should handle data with few distinct values", () => {
		const digest = new TDigest();
		const { random } = distributions(5);
		const data = fill(digest, 50_000, () => Math.floor(random() * 20));
		assertAccurate(digest, data);
	});

	for (const seed of [3, 5, 6, 7]) {
		it(`should bound rank error across a discrete distribution with seed ${seed}`, () => {
			const digest = new TDigest();
			const { random } = distributions(seed);
			const sorted = fill(digest, 50_000, () =>
				Math.floor(random() * 20),
			).sort();
			// Interpolation near an atom is less forgiving in rank space than in value
			// space. Check the whole quantile range, not just the atom boundaries.
			for (let i = 1; i < 1000; i++) {
				const q = i / 1000;
				const error = rankError(sorted, digest.quantile(q), q);
				assert.ok(error <= 0.03, `rank error ${error} at q=${q}`);
			}
		});
	}

	it("should bound rank error near the transition of multimodal data", () => {
		const digest = new TDigest();
		const { random, normal } = distributions(6);
		// 30% of the values are around 0, 70% around 100
		const sorted = fill(digest, 50_000, () =>
			random() < 0.3 ? normal() : 100 + normal(),
		).sort();

		// Unlike smooth data, a centroid straddling a gap can still have noticeable
		// rank error. Probe the transition instead of only checking inside the modes.
		for (let i = 1; i < 1000; i++) {
			const q = i / 1000;
			const error = rankError(sorted, digest.quantile(q), q);
			assert.ok(error <= 0.025, `rank error ${error} at q=${q}`);
		}
		assertAccurate(digest, sorted);
	});

	for (const fraction of [0.3, 0.5]) {
		for (const narrow of [false, true]) {
			for (const order of ["ascending", "descending", "interleaved"] as const) {
				for (const readEvery of [0, 1, 100]) {
					it(`should retain accuracy for ${fraction} separated ${narrow ? "continuous" : "discrete"} modes, ${order}, reading every ${readEvery} observations`, () => {
						const size = 50_000;
						const split = size * fraction;
						const sorted = Float64Array.from({ length: size }, (_, i) =>
							i < split
								? narrow
									? (i / split) * 0.01
									: 0
								: narrow
									? 100 + ((i - split) / (size - split)) * 0.01
									: 100,
						);
						const digest = new TDigest();
						let low = 0;
						let high = split;
						for (let i = 0; i < size; i++) {
							const index =
								order === "ascending"
									? i
									: order === "descending"
										? size - 1 - i
										: i % 100 < fraction * 100
											? low++
											: high++;
							digest.observe(sorted[index]);
							if (readEvery && (i + 1) % readEvery === 0) digest.quantile(0.25);
						}
						assert.equal(digest.count, size);
						for (const q of [...MIDDLE_QUANTILES, ...TAIL_QUANTILES, 0.4]) {
							const error = rankError(sorted, digest.quantile(q), q);
							const limit = narrow ? 0.025 : MAX_MIDDLE_ERROR;
							assert.ok(error <= limit, `rank error ${error} at q=${q}`);
						}
						assert.equal(digest.quantile(0), sorted[0]);
						assert.equal(digest.quantile(1), sorted[size - 1]);
					});
				}
			}
		}
	}

	it("should keep working with a very small compression", () => {
		// a tiny compression gives a tiny buffer, which forces a merge every few values
		const digest = new TDigest(10);
		const { uniform } = distributions(7);
		const data = fill(digest, 5_000, uniform);

		assert.equal(digest.count, 5_000);
		assert.equal(digest.min, Math.min(...data));
		assert.equal(digest.max, Math.max(...data));
		const sorted = data.slice().sort();
		assert.ok(rankError(sorted, digest.quantile(0.5), 0.5) < 0.1);
	});

	it("should be more accurate with a higher compression", () => {
		const { lognormal } = distributions(8);
		const coarse = new TDigest(20);
		const fine = new TDigest(500);
		const data = new Float64Array(100_000);
		for (let i = 0; i < data.length; i++) {
			data[i] = lognormal();
			coarse.observe(data[i]);
			fine.observe(data[i]);
		}
		const sorted = data.slice().sort();
		const total = (digest: TDigest) =>
			MIDDLE_QUANTILES.reduce(
				(sum, q) => sum + rankError(sorted, digest.quantile(q), q),
				0,
			);

		assert.ok(total(fine) < total(coarse));
		assert.ok(fine.centroidCount > coarse.centroidCount);
	});

	it("should clear", () => {
		const digest = new TDigest();
		fill(digest, 10_000, distributions(9).uniform);
		digest.clear();

		assert.equal(digest.count, 0);
		assert.equal(digest.centroidCount, 0);
		assert.ok(Number.isNaN(digest.quantile(0.5)));
		assert.equal(digest.min, Number.POSITIVE_INFINITY);
		assert.equal(digest.max, Number.NEGATIVE_INFINITY);

		digest.observe(5);
		assert.equal(digest.quantile(0.5), 5);
		assert.equal(digest.count, 1);
	});

	describe("merge", () => {
		it("should keep merged and single digests within the same accuracy bounds", () => {
			const { lognormal } = distributions(10);
			const parts = Array.from({ length: 8 }, () => new TDigest());
			const single = new TDigest();
			const data = new Float64Array(120_000);
			for (let i = 0; i < data.length; i++) {
				data[i] = lognormal();
				parts[i % parts.length].observe(data[i]);
				single.observe(data[i]);
			}

			const merged = new TDigest();
			merged.merge(...parts);

			assert.equal(merged.count, data.length);
			assert.equal(merged.min, Math.min(...data));
			assert.equal(merged.max, Math.max(...data));
			assertAccurate(merged, data);
			assertAccurate(single, data);
		});

		for (const bulk of [false, true]) {
			for (const reverse of [false, true]) {
				it(`should preserve tied-data accuracy when merging ${bulk ? "all at once" : "sequentially"}, ${reverse ? "backward" : "forward"}`, () => {
					const parts = Array.from({ length: 8 }, () => new TDigest());
					const data = new Float64Array(50_000);
					for (let i = 0; i < data.length; i++) {
						data[i] = i % 100 < 50 ? 0 : 100;
						parts[i % parts.length].observe(data[i]);
					}
					if (reverse) parts.reverse();
					const merged = new TDigest();
					if (bulk) merged.merge(...parts);
					else for (const part of parts) merged.merge(part);
					assert.equal(merged.count, data.length);
					assert.equal(merged.quantile(0.4), 0);
					assertAccurate(merged, data);
				});
			}
		}

		it("should merge several pending sources into a nonempty target without changing them", () => {
			const target = new TDigest();
			const sources = [new TDigest(), new TDigest(), new TDigest()];
			for (let i = 1; i <= 100; i++) {
				target.observe(i);
				sources[0].observe(100 + i);
				sources[2].observe(200 + i);
			}
			target.merge(...sources);
			assert.equal(target.count, 300);
			assert.equal(target.quantile(0), 1);
			assert.equal(target.quantile(1), 300);
			assert.ok(Math.abs(target.quantile(0.5) - 150.5) < 1);
			assert.deepEqual(
				sources.map((source) => source.count),
				[100, 0, 100],
			);
			assert.equal(sources[0].quantile(0.5), 150.5);
			assert.equal(sources[2].quantile(0.5), 250.5);
		});

		it("should merge digests that cover different ranges", () => {
			const low = new TDigest();
			const high = new TDigest();
			for (let i = 0; i < 10_000; i++) {
				low.observe(i);
				high.observe(10_000 + i);
			}
			const merged = new TDigest();
			merged.merge(high);
			merged.merge(low);

			assert.equal(merged.quantile(0), 0);
			assert.equal(merged.quantile(1), 19_999);
			assert.ok(Math.abs(merged.quantile(0.5) - 10_000) < 100);
		});

		it("should add to a digest that already has data", () => {
			const target = new TDigest();
			const source = new TDigest();
			for (let i = 1; i <= 100; i++) target.observe(i);
			for (let i = 101; i <= 200; i++) source.observe(i);

			target.merge(source);
			assert.equal(target.count, 200);
			assert.equal(target.quantile(0), 1);
			assert.equal(target.quantile(1), 200);
			assert.ok(Math.abs(target.quantile(0.5) - 100.5) < 1);
		});

		it("should not modify the digest that was merged in", () => {
			const source = new TDigest();
			fill(source, 10_000, distributions(11).uniform);
			const before = [0, 0.25, 0.5, 0.99, 1].map((q) => source.quantile(q));

			const target = new TDigest();
			target.merge(source);
			target.observe(1_000);

			assert.equal(source.count, 10_000);
			assert.deepEqual(
				[0, 0.25, 0.5, 0.99, 1].map((q) => source.quantile(q)),
				before,
			);
		});

		it("should ignore empty digests", () => {
			const digest = new TDigest();
			digest.observe(1);
			digest.observe(2);
			digest.merge(new TDigest());

			assert.equal(digest.count, 2);
			assert.equal(digest.quantile(0), 1);
			assert.equal(digest.quantile(1), 2);
		});

		it("should not allow merging a digest into itself", () => {
			const digest = new TDigest();
			digest.observe(1);
			assert.throws(() => digest.merge(digest), /itself/);
			const other = new TDigest();
			other.observe(2);
			assert.throws(() => digest.merge(other, digest), /itself/);
			assert.equal(digest.count, 1);
			assert.equal(other.count, 1);
		});
	});
});
