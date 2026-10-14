// A small t-digest, following the structure of the `MergingDigest` in the reference
// implementation (https://github.com/tdunning/t-digest) and the paper
// "Computing Extremely Accurate Quantiles Using t-Digests" (Dunning & Ertl).
//
// Observations are collected in a buffer. When it fills up (or a quantile is requested),
// the buffer is sorted and merged with the existing centroids in a single pass. Centroids
// are only combined while they stay within the size limit given by the scale function,
// which keeps centroids tiny near q=0 and q=1 and lets them grow in the middle.

// Compression controls centroid size, not a guaranteed rank-error bound. In particular,
// interpolation across gaps or repeated values can be less accurate than on smooth data.
// Retaining more centroids reduces gap contamination without changing the quantile convention.
const DEFAULT_COMPRESSION = 400;

// Output of a merge pass is built here, then copied back into the digest. Merging is
// synchronous, so one pair of arrays can be shared by every digest.
const scratchMean: number[] = [];
const scratchWeight: number[] = [];

export class TDigest {
	readonly #compression: number;
	readonly #bufferLimit: number;

	// centroids, sorted by mean
	#mean: number[] = [];
	#weight: number[] = [];
	// total weight of all centroids
	#merged = 0;
	#mergeBackwards = false;

	// unmerged observations (each has weight 1). Starts empty and grows on demand so
	// that idle digests (e.g. empty window slots) cost almost nothing.
	#buffer = new Float64Array(0);
	#bufferLength = 0;

	#min = Number.POSITIVE_INFINITY;
	#max = Number.NEGATIVE_INFINITY;

	/**
	 * @param compression Accuracy/size trade-off: the digest holds on the order of `compression`
	 * centroids. Higher is more accurate, particularly away from the tails.
	 */
	constructor(compression = DEFAULT_COMPRESSION) {
		if (!Number.isFinite(compression) || compression <= 0) {
			throw new RangeError("compression must be a positive, finite number");
		}
		this.#compression = compression;
		this.#bufferLimit = Math.ceil(2 * compression);
	}

	/** Number of observations in the digest */
	get count() {
		return this.#merged + this.#bufferLength;
	}

	/** Smallest observation, or `Infinity` when empty */
	get min() {
		return this.#min;
	}

	/** Largest observation, or `-Infinity` when empty */
	get max() {
		return this.#max;
	}

	/** Number of centroids after merging pending observations */
	get centroidCount() {
		this.#flush();
		return this.#mean.length;
	}

	/**
	 * Add an observation
	 */
	observe(value: number) {
		if (!Number.isFinite(value)) {
			throw new TypeError(`Value is not a valid number: ${value}`);
		}
		if (this.#bufferLength === this.#buffer.length) {
			if (this.#buffer.length < this.#bufferLimit) {
				this.#growBuffer();
			} else {
				this.#flush();
			}
		}
		this.#buffer[this.#bufferLength++] = value;
		if (value < this.#min) this.#min = value;
		if (value > this.#max) this.#max = value;
	}

	/**
	 * Add everything from the given digests in one merge pass, avoiding repeated
	 * compression of the intermediate result. Sources are not modified apart from
	 * merging their pending observations.
	 */
	merge(...others: TDigest[]) {
		if (others.includes(this)) {
			throw new Error("cannot merge a digest into itself");
		}
		this.#flush();
		const nonempty = others.filter((other) => {
			other.#flush();
			return other.#merged > 0;
		});
		if (nonempty.length === 0) return;

		if (nonempty.length === 1) {
			const other = nonempty[0];
			this.#mergeStream(
				other.#mean,
				other.#weight,
				other.#mean.length,
				other.#merged,
			);
		} else {
			const means: number[] = [];
			const weights: number[] = [];
			let total = 0;
			for (const other of nonempty) {
				for (let i = 0; i < other.#mean.length; i++) {
					means.push(other.#mean[i]);
					weights.push(other.#weight[i]);
				}
				total += other.#merged;
			}
			const order = means.map((_, i) => i).sort((a, b) => means[a] - means[b]);
			this.#mergeStream(
				order.map((i) => means[i]),
				order.map((i) => weights[i]),
				order.length,
				total,
			);
		}
		for (const other of nonempty) {
			if (other.#min < this.#min) this.#min = other.#min;
			if (other.#max > this.#max) this.#max = other.#max;
		}
	}

	/**
	 * Estimate the value at quantile `q`
	 * @param q A number between 0 and 1 (inclusive)
	 * @returns The estimate, or `NaN` if the digest is empty
	 */
	quantile(q: number) {
		if (!(q >= 0 && q <= 1)) {
			throw new RangeError("quantile must be between 0 and 1");
		}
		this.#flush();

		const total = this.#merged;
		if (total === 0) return Number.NaN;

		const mean = this.#mean;
		const weight = this.#weight;
		const rank = q * total;

		// Centroid i sits at the middle of the ranks it covers. We interpolate linearly
		// between neighbouring centroids, treating the minimum as sitting at rank 0 and
		// the maximum at rank `total`. Since the first and last centroids are always
		// single observations, those end segments are flat.
		let previousCenter = 0;
		let previousValue = this.#min;
		let cumulative = 0;
		for (let i = 0; i < mean.length; i++) {
			const center = cumulative + weight[i] / 2;
			if (rank <= center) {
				return interpolate(
					previousCenter,
					previousValue,
					center,
					mean[i],
					rank,
				);
			}
			previousCenter = center;
			previousValue = mean[i];
			cumulative += weight[i];
		}
		return interpolate(previousCenter, previousValue, total, this.#max, rank);
	}

	/**
	 * Remove all observations
	 */
	clear() {
		this.#mean.length = 0;
		this.#weight.length = 0;
		this.#merged = 0;
		this.#mergeBackwards = false;
		this.#bufferLength = 0;
		// release the buffer; it grows back on demand
		this.#buffer = new Float64Array(0);
		this.#min = Number.POSITIVE_INFINITY;
		this.#max = Number.NEGATIVE_INFINITY;
	}

	#growBuffer() {
		const size = Math.min(
			Math.max(16, this.#buffer.length * 2),
			this.#bufferLimit,
		);
		const grown = new Float64Array(size);
		grown.set(this.#buffer.subarray(0, this.#bufferLength));
		this.#buffer = grown;
	}

	#flush() {
		const length = this.#bufferLength;
		if (length === 0) return;
		const sorted = this.#buffer.subarray(0, length).sort();
		this.#mergeStream(sorted, null, length, length);
		this.#bufferLength = 0;
	}

	/**
	 * Merge a sorted stream of (mean, weight) pairs into the centroids.
	 * @param incomingWeight Weights for the incoming means, or `null` if all are 1
	 * @param incomingTotal Sum of the incoming weights
	 */
	#mergeStream(
		incomingMean: ArrayLike<number>,
		incomingWeight: ArrayLike<number> | null,
		incomingLength: number,
		incomingTotal: number,
	) {
		const mean = this.#mean;
		const weight = this.#weight;
		const existingLength = mean.length;
		const inputs = existingLength + incomingLength;
		const total = this.#merged + incomingTotal;

		// from the reference implementation: the normalizer shrinks as the number of
		// observations grows relative to the compression
		const compression = this.#compression;
		const normalizer =
			compression /
			(4 * Math.log(Math.max(total, compression) / compression) + 24);

		// Alternating the traversal avoids consistently smearing centroids in one direction.
		const backwards = this.#mergeBackwards;
		this.#mergeBackwards = !backwards;
		const direction = backwards ? -1 : 1;
		let weightSoFar = 0;
		let existingIndex = backwards ? existingLength - 1 : 0;
		let incomingIndex = backwards ? incomingLength - 1 : 0;
		let existingRemaining = existingLength;
		let incomingRemaining = incomingLength;
		let outputLength = 0;
		let currentMean = 0;
		let currentWeight = 0;

		for (let i = 0; i < inputs; i++) {
			// take the next centroid in sorted order
			let nextMean: number;
			let nextWeight: number;
			if (
				incomingRemaining === 0 ||
				(existingRemaining > 0 &&
					(backwards
						? mean[existingIndex] > incomingMean[incomingIndex]
						: mean[existingIndex] < incomingMean[incomingIndex]))
			) {
				nextMean = mean[existingIndex];
				nextWeight = weight[existingIndex];
				existingIndex += direction;
				existingRemaining--;
			} else {
				nextMean = incomingMean[incomingIndex];
				nextWeight = incomingWeight ? incomingWeight[incomingIndex] : 1;
				incomingIndex += direction;
				incomingRemaining--;
			}

			if (i === 0) {
				currentMean = nextMean;
				currentWeight = nextWeight;
				continue;
			}

			const proposedWeight = currentWeight + nextWeight;
			const qStart = weightSoFar / total;
			const qEnd = (weightSoFar + proposedWeight) / total;
			// K_2's endpoint weight limit is conservative at both edges of a centroid.
			const weightLimit =
				(total / normalizer) *
				Math.min(qStart * (1 - qStart), qEnd * (1 - qEnd));
			// as in the reference implementation, the first and last centroids are never
			// merged with a neighbour. (With this scale function the size limit already
			// keeps the extremes alone in practice, so this is a safeguard.)
			const fits = proposedWeight <= weightLimit && i !== 1 && i !== inputs - 1;

			if (fits) {
				currentWeight = proposedWeight;
				currentMean = interpolate(
					0,
					currentMean,
					proposedWeight,
					nextMean,
					nextWeight,
				);
			} else {
				scratchMean[outputLength] = currentMean;
				scratchWeight[outputLength] = currentWeight;
				outputLength++;

				weightSoFar += currentWeight;

				currentMean = nextMean;
				currentWeight = nextWeight;
			}
		}
		scratchMean[outputLength] = currentMean;
		scratchWeight[outputLength] = currentWeight;
		outputLength++;

		mean.length = outputLength;
		weight.length = outputLength;
		for (let i = 0; i < outputLength; i++) {
			const index = backwards ? outputLength - 1 - i : i;
			mean[i] = scratchMean[index];
			weight[i] = scratchWeight[index];
		}
		this.#merged = total;
	}
}

function interpolate(
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	x: number,
) {
	const span = x1 - x0;
	if (span <= 0) return y1;
	const fraction = (x - x0) / span;
	// Opposite-sign endpoints can overflow when subtracted, even if both are finite.
	return y0 < 0 !== y1 < 0
		? y0 * (1 - fraction) + y1 * fraction
		: y0 + (y1 - y0) * fraction;
}
