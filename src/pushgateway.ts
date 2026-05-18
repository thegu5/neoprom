import { globalRegistry, type Registry } from "./registry.ts";

interface PushgatewayOptions {
	url: string;
	registry?: Registry;
	// the Pushgateway server also supports 'snappy' compression, which we don't support
	// (would require extra dependencies)
	compression?: "gzip";
}

type Groupings = { job: string } & Record<string, string>;

export class Pushgateway {
	readonly #url: URL;
	readonly #registry: Registry;
	readonly #compression: "gzip" | undefined;

	constructor(opts: PushgatewayOptions) {
		this.#url = new URL(opts.url);
		this.#registry = opts.registry ?? globalRegistry;
		this.#compression = opts.compression;
	}

	async pushAdd(groupings: Groupings) {
		await this.#send(groupings, "POST");
	}

	async push(groupings: Groupings) {
		await this.#send(groupings, "PUT");
	}

	async delete(groupings: Groupings) {
		await this.#send(groupings, "DELETE");
	}

	async #send(groupings: Groupings, method: "POST" | "PUT" | "DELETE") {
		const url = new URL(this.#url);
		if (!url.pathname.endsWith("/")) url.pathname += "/";

		const groupStr = Object.entries(groupings)
			.filter(([key]) => key !== "job")
			.map(
				([key, value]) =>
					`/${encodeURIComponent(key)}/${encodeURIComponent(value)}`,
			)
			.join("");

		url.pathname += `metrics/job/${encodeURIComponent(groupings.job)}${groupStr}`;

		let body: RequestInit["body"];
		if (method !== "DELETE") {
			body = await this.#registry.getMetrics();
			if (this.#compression === "gzip") {
				body = await new Response(
					new Blob([body]).stream().pipeThrough(new CompressionStream("gzip")),
				).arrayBuffer();
			}
		}

		const headers = new Headers();
		if (method !== "DELETE") {
			headers.set("Content-Type", this.#registry.contentType);
			if (this.#compression === "gzip") {
				headers.set("Content-Encoding", "gzip");
			}
		}

		const resp = await fetch(url, {
			method,
			headers,
			body,
		});
		if (resp.status >= 400) {
			throw new Error(
				`push failed with status ${resp.status}, ${await resp.text()}`,
			);
		}
	}
}
