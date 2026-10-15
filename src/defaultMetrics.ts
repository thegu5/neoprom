import { readdir, readFile } from "node:fs/promises";
import { Counter } from "./metrics/counter.ts";
import { Gauge } from "./metrics/gauge.ts";
import type { Metric } from "./metrics/metric.ts";

// TODO: runtime-specific data? should work across nodejs/bun/workerd

const processStartTime = Date.now() / 1000 - process.uptime();

/**
 * Client-agnostic metrics covering details about the current process
 */
export const defaultMetrics: Metric[] = [
	new Counter({
		name: "process_cpu_seconds_total",
		help: "Total user and system CPU time spent in seconds.",
		registries: [],
		collect() {
			this.reset();
			const usage = process.cpuUsage(); // todo double check workers
			this.inc((usage.system + usage.user) / 1e6);
		},
	}),
	process.platform === "linux"
		? new Gauge({
				name: "process_open_fds",
				help: "Number of open file descriptors.",
				registries: [],
				async collect() {
					this.set((await readdir("/proc/self/fd")).length - 1);
				},
			})
		: null,
	process.platform === "linux"
		? new Gauge({
				name: "process_max_fds",
				help: "Maximum number of open file descriptors.",
				registries: [],
				async collect() {
					const limits = await readFile("/proc/self/limits", "utf-8");
					const val = Number(
						limits
							.split("\n")
							.find((l) => l.startsWith("Max open files"))
							?.split(/ {2,}/)[1],
					);
					if (val) this.set(val);
				},
			})
		: null,
	process.platform === "linux"
		? new Gauge({
				name: "process_virtual_memory_bytes",
				help: "Virtual memory size in bytes.",
				registries: [],
				async collect() {
					const status = await readFile("/proc/self/status", "utf-8");
					const label = "VmSize:";
					const line = status
						.split("\n")
						.find((line) => line.startsWith(label));
					if (line !== undefined) {
						const kibibytes = Number.parseInt(
							line.slice(label.length).trim(),
							10,
						);
						if (!Number.isNaN(kibibytes)) this.set(kibibytes * 1024);
					}
				},
			})
		: null,
	process.platform === "linux"
		? new Gauge({
				name: "process_virtual_memory_max_bytes",
				help: "Maximum amount of virtual memory available in bytes.",
				registries: [],
				async collect() {
					const limits = await readFile("/proc/self/limits", "utf-8");
					const label = "Max address space";
					const line = limits
						.split("\n")
						.find((line) => line.startsWith(label));
					if (line !== undefined) {
						const value = line.slice(label.length).trim();
						const bytes = value.startsWith("unlimited")
							? Infinity
							: Number.parseInt(value, 10);
						if (!Number.isNaN(bytes)) this.set(bytes);
					}
				},
			})
		: null,
	new Gauge({
		name: "process_resident_memory_bytes",
		help: "Resident memory size in bytes.",
		registries: [],
		collect() {
			this.set(process.memoryUsage.rss());
		},
	}),
	new Gauge({
		name: "process_heap_bytes",
		help: "Total size of the JavaScript heap in bytes.",
		registries: [],
		collect() {
			this.set(process.memoryUsage().heapTotal);
		},
	}),
	new Gauge({
		name: "process_start_time_seconds",
		help: "Start time of the process since unix epoch in seconds.",
		registries: [],
		collect() {
			this.set(processStartTime);
		},
	}),
].filter((m) => m !== null);
