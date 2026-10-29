import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Hono } from "hono";
import { Counter } from "../src/metrics/counter.ts";
import { Info } from "../src/metrics/info.ts";
import { prometheus } from "../src/middleware/hono.ts";
import { Registry, RegistryContentType } from "../src/registry.ts";

function createApp(registry?: Registry) {
	const app = new Hono();
	app.use("*", prometheus({ registry }));
	app.get("/users/:id", (c) => c.text("Hello!"));
	app.post("/users", (c) => c.text("Created", 201));
	app.get("/failure", () => {
		throw new Error("Failure");
	});
	app.onError((error, c) => c.text(error.stack ?? error.message, 503));
	return app;
}

async function scrape(app: Hono, accept?: string) {
	const response = await app.request("/metrics", {
		headers: accept ? { Accept: accept } : {},
	});
	const body = await response.text();
	assert.equal(response.status, 200, body);
	return { response, body };
}

const openMetricsHeader = `${RegistryContentType.OpenMetricsV1}; escaping=allow-utf-8`;

describe("Hono middleware", () => {
	it("collects counts and durations using route templates", async () => {
		const app = createApp();
		await app.request("/users/123?ignored=true");
		await app.request("/users/456");
		await app.request("/users", { method: "POST" });
		const { response, body } = await scrape(app);
		assert.equal(
			response.headers.get("Content-Type"),
			RegistryContentType.Prometheus,
		);
		const labels = 'method="GET",route="/users/:id",status="200",ok="true"';
		assert.ok(body.includes(`http_requests_total{${labels}} 2\n`));
		assert.ok(
			body.includes(`http_request_duration_seconds_count{${labels}} 2\n`),
		);
		assert.ok(
			body.includes(
				`http_request_duration_seconds_bucket{le="+Inf",${labels}} 2\n`,
			),
		);
		const sum = body
			.split("\n")
			.find((line) =>
				line.startsWith(`http_request_duration_seconds_sum{${labels}} `),
			);
		assert.ok(sum);
		assert.ok(Number(sum.split(" ").at(-1)) >= 0);
		assert.ok(
			body.includes(
				'http_requests_total{method="POST",route="/users",status="201",ok="true"} 1\n',
			),
		);
		assert.ok(!body.includes("/users/123"));
		assert.ok(!body.includes("# EOF"));
		assert.equal((await scrape(app)).body, body);
	});

	it("includes custom metrics and runs their collectors", async () => {
		const registry = new Registry();
		const counter = new Counter({
			name: "custom",
			help: "Custom metric",
			registries: [registry],
			collect() {
				this.inc();
			},
		});
		const app = createApp(registry);
		assert.ok((await scrape(app)).body.includes("custom_total 1\n"));
		assert.equal(counter.getValues().next().value?.value, 1);
	});

	it("creates isolated registries by default", async () => {
		const first = createApp();
		const second = createApp();
		await first.request("/users/123");
		assert.ok((await scrape(first)).body.includes("http_requests_total"));
		assert.ok(!(await scrape(second)).body.includes("http_requests_total"));
	});

	it("records handled errors and groups unmatched paths", async () => {
		const app = createApp();
		assert.equal((await app.request("/failure")).status, 503);
		await app.request("/missing-one");
		await app.request("/missing-two");
		const { body } = await scrape(app);
		assert.ok(
			body.includes(
				'http_requests_total{method="GET",route="/failure",status="503",ok="false"} 1\n',
			),
		);
		assert.ok(
			body.includes(
				'http_requests_total{method="GET",route="/*",status="404",ok="false"} 2\n',
			),
		);
	});

	it("does not intercept non-GET metrics requests", async () => {
		const app = createApp();
		assert.notEqual(
			(await app.request("/metrics", { method: "POST" })).status,
			200,
		);
	});

	it("uses the configured OpenMetrics format without Accept", async () => {
		const app = createApp(new Registry({ contentType: "OpenMetricsV1" }));
		await app.request("/users/123");
		const { response, body } = await scrape(app);
		assert.equal(response.headers.get("Content-Type"), openMetricsHeader);
		assert.ok(body.includes("# UNIT http_request_duration_seconds seconds\n"));
		assert.ok(body.endsWith("# EOF\n"));
	});

	it("negotiates supported formats by quality without mutating the registry", async () => {
		const registry = new Registry();
		const app = createApp(registry);
		await app.request("/users/123");
		const { response, body } = await scrape(
			app,
			"application/vnd.google.protobuf;proto=io.prometheus.client.MetricFamily;encoding=delimited;q=1, text/plain;version=0.0.4;q=0.5, application/openmetrics-text;version=1.0.0;escaping=allow-utf-8;q=0.9, */*;q=0.1",
		);
		assert.equal(response.headers.get("Content-Type"), openMetricsHeader);
		assert.ok(body.endsWith("# EOF\n"));
		assert.equal(registry.contentType, RegistryContentType.Prometheus);
		assert.ok(!(await registry.getMetrics()).includes("# EOF"));
		const legacy = await scrape(
			app,
			"application/openmetrics-text;version=1.0.0;q=0.1, text/plain;version=0.0.4;q=0.9",
		);
		assert.equal(
			legacy.response.headers.get("Content-Type"),
			RegistryContentType.Prometheus,
		);
		assert.ok(!legacy.body.includes("# EOF"));
	});

	it("ignores unsupported versions, escaping schemes and invalid qualities", async () => {
		const app = createApp();
		for (const accept of [
			"text/plain;version=1.0.0, application/openmetrics-text;version=0.0.1",
			"application/openmetrics-text;version=1.0.0;escaping=underscores",
			"application/openmetrics-text;version=1.0.0;q=0",
			"application/openmetrics-text;version=1.0.0;q=1.5",
			"application/openmetrics-text;version=1.0.0;q=NaN",
			"application/openmetrics-text;version=1.0.0;escaping=invalid",
		]) {
			assert.equal(
				(await scrape(app, accept)).response.headers.get("Content-Type"),
				RegistryContentType.Prometheus,
			);
		}
	});

	it("can collect an OpenMetrics-only metric with a per-call override", async () => {
		const registry = new Registry();
		const info = new Info({
			name: "build",
			help: "Build information",
			registries: [registry],
		});
		info.set({ version: "1" });
		const app = createApp(registry);
		const { body } = await scrape(
			app,
			"application/openmetrics-text;version=1.0.0",
		);
		assert.ok(body.includes('build_info{version="1"} 1\n'));
		assert.ok(body.endsWith("# EOF\n"));
		await assert.rejects(
			registry.getMetrics(),
			/Info metric is only supported/,
		);
	});
});
