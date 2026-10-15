import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { afterEach, describe, it, mock } from "node:test";
import { defaultMetrics } from "../src/defaultMetrics.ts";
import { Gauge } from "../src/metrics/gauge.ts";
import { globalRegistry, Registry } from "../src/registry.ts";

function getGauge(name: string) {
	const metric = defaultMetrics.find((metric) => metric.name === name);
	assert.ok(metric instanceof Gauge, `${name} should be a gauge`);
	return metric;
}

function getValue(metric: Gauge) {
	return Array.from(metric.getValues())[0].value;
}

// cursed
function mockProcFile(contents: string) {
	const readFile = mock.method(fs, "readFile", async () => contents);
	syncBuiltinESMExports();
	return readFile;
}

describe("default metrics", () => {
	afterEach(() => {
		mock.restoreAll();
		syncBuiltinESMExports();
		for (const metric of defaultMetrics) metric.reset();
	});

	it("does not register metrics globally", async () => {
		assert.equal(await globalRegistry.getMetrics(), "");
	});

	it("only includes proc-based metrics on Linux", () => {
		for (const name of [
			"process_open_fds",
			"process_max_fds",
			"process_virtual_memory_bytes",
			"process_virtual_memory_max_bytes",
		]) {
			assert.equal(
				defaultMetrics.some((metric) => metric.name === name),
				process.platform === "linux",
			);
		}
	});

	it("collects total allocated heap bytes on each scrape", async () => {
		const metric = getGauge("process_heap_bytes");
		const usage = process.memoryUsage();
		const memoryUsage = mock.method(process, "memoryUsage", () => ({
			...usage,
			heapTotal: 8192,
			heapUsed: 4096,
		}));

		await metric.collect();
		assert.equal(getValue(metric), 8192);

		memoryUsage.mock.mockImplementation(() => ({ ...usage, heapTotal: 16384 }));
		await metric.collect();
		assert.equal(getValue(metric), 16384);
	});

	it("reports a stable process start timestamp rather than uptime", async () => {
		const metric = getGauge("process_start_time_seconds");
		await metric.collect();
		const start = getValue(metric);
		assert.ok(Math.abs(start - (Date.now() / 1000 - process.uptime())) < 1);

		mock.method(Date, "now", () => 0);
		mock.method(process, "uptime", () => 999999);
		await metric.collect();
		assert.equal(getValue(metric), start);

		metric.reset();
		await metric.collect();
		assert.equal(getValue(metric), start);
	});

	it("collects and serializes all metrics in both exposition formats", async () => {
		for (const contentType of ["Prometheus", "OpenMetricsV1"] as const) {
			const registry = new Registry({ contentType });
			registry.register(...defaultMetrics);
			const output = await registry.getMetrics();
			for (const metric of defaultMetrics) {
				assert.ok(output.includes(`# HELP ${metric.name} `));
				assert.match(output, new RegExp(`^${metric.name} (?!NaN).+$`, "m"));
			}
			assert.ok(output.includes("# TYPE process_heap_bytes gauge\n"));
			assert.ok(output.includes("# TYPE process_start_time_seconds gauge\n"));
		}
	});

	describe("Linux virtual memory", {
		skip: process.platform !== "linux",
	}, () => {
		it("converts VmSize from KiB to bytes and refreshes on collection", async () => {
			const metric = getGauge("process_virtual_memory_bytes");
			const readFile = mockProcFile("Name:\tnode\nVmSize:\t  12345 kB\n");
			await metric.collect();
			assert.equal(getValue(metric), 12345 * 1024);
			assert.deepEqual(readFile.mock.calls[0].arguments, [
				"/proc/self/status",
				"utf-8",
			]);

			readFile.mock.mockImplementation(async () => "VmSize:\t67890 kB\n");
			await metric.collect();
			assert.equal(getValue(metric), 67890 * 1024);
		});

		it("uses the soft address space limit in bytes, not the hard limit", async () => {
			const metric = getGauge("process_virtual_memory_max_bytes");
			const readFile = mockProcFile(
				"Limit                     Soft Limit           Hard Limit           Units\n" +
					"Max open files            1024                 4096                 files\n" +
					"Max address space         1073741824           2147483648           bytes\n",
			);
			await metric.collect();
			assert.equal(getValue(metric), 1073741824);
			assert.deepEqual(readFile.mock.calls[0].arguments, [
				"/proc/self/limits",
				"utf-8",
			]);
		});

		it("exports unlimited address space as positive infinity", async () => {
			mockProcFile(
				"Max address space         unlimited            unlimited            bytes\n",
			);
			const registry = new Registry();
			registry.register(getGauge("process_virtual_memory_max_bytes"));
			assert.ok(
				(await registry.getMetrics()).includes(
					"process_virtual_memory_max_bytes +Inf\n",
				),
			);
		});

		it("accepts a zero address space limit", async () => {
			const metric = getGauge("process_virtual_memory_max_bytes");
			mockProcFile(
				"Max address space         0                    unlimited            bytes\n",
			);
			metric.set(1024);
			await metric.collect();
			assert.equal(getValue(metric), 0);
		});

		it("does not replace values with NaN when proc fields are nonnumeric", async () => {
			mockProcFile(
				"VmSize:\tinvalid kB\nMax address space         invalid              unlimited            bytes\n",
			);
			for (const name of [
				"process_virtual_memory_bytes",
				"process_virtual_memory_max_bytes",
			]) {
				const metric = getGauge(name);
				metric.set(1024);
				await metric.collect();
				assert.equal(getValue(metric), 1024);
			}
		});

		it("does not replace values with NaN when proc fields are missing", async () => {
			mockProcFile("Name:\tnode\n");
			for (const name of [
				"process_virtual_memory_bytes",
				"process_virtual_memory_max_bytes",
			]) {
				const metric = getGauge(name);
				metric.set(1024);
				await metric.collect();
				assert.equal(getValue(metric), 1024);
			}
		});
	});
});
