import { readdir, readFile } from "node:fs/promises";
import { Counter } from "./counter.ts";
import { Gauge } from "./gauge.ts";
import type { Metric } from "./metric.ts";

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
	null, // TODO: process_virtual_memory_bytes
	null, // TODO: process_virtual_memory_max_bytes
	null, // TODO: process_resident_memory_bytes
	null, // TODO: process_heap_bytes
	new Counter({
		name: "process_start_time_seconds",
		help: "Start time of the process since unix epoch in seconds.",
		registries: [],
		collect() {
			this.reset();
			this.inc(process.uptime());
		},
	}),
].filter((m) => m !== null);

// TODO: runtime-specific data? should work across nodejs/bun/deno/workerd
