import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Info } from "../../src/metrics/info.ts";
import {
	buildHttpMetrics,
	createMiddlewareHelper,
	negotiateContentType,
} from "../../src/middleware/utils.ts";
import { Registry, RegistryContentType } from "../../src/registry.ts";

const openMetricsHeader = `${RegistryContentType.OpenMetricsV1}; escaping=allow-utf-8`;

describe("negotiateContentType", () => {
	it("returns the fallback without an Accept header", () => {
		assert.equal(
			negotiateContentType(undefined, RegistryContentType.OpenMetricsV1),
			RegistryContentType.OpenMetricsV1,
		);
		assert.equal(
			negotiateContentType("", RegistryContentType.Prometheus),
			RegistryContentType.Prometheus,
		);
	});

	it("selects supported formats by quality", () => {
		assert.equal(
			negotiateContentType(
				"application/vnd.google.protobuf;proto=io.prometheus.client.MetricFamily;encoding=delimited;q=1, text/plain;version=0.0.4;q=0.5, application/openmetrics-text;version=1.0.0;escaping=allow-utf-8;q=0.9, */*;q=0.1",
				RegistryContentType.Prometheus,
			),
			RegistryContentType.OpenMetricsV1,
		);
		assert.equal(
			negotiateContentType(
				"application/openmetrics-text;version=1.0.0;q=0.1, text/plain;version=0.0.4;q=0.9",
				RegistryContentType.OpenMetricsV1,
			),
			RegistryContentType.Prometheus,
		);
	});

	it("ignores unsupported versions, escaping schemes and invalid qualities", () => {
		for (const accept of [
			"text/plain;version=1.0.0, application/openmetrics-text;version=0.0.1",
			"application/openmetrics-text;version=1.0.0;escaping=underscores",
			"application/openmetrics-text;version=1.0.0;q=0",
			"application/openmetrics-text;version=1.0.0;q=1.5",
			"application/openmetrics-text;version=1.0.0;q=NaN",
			"application/openmetrics-text;version=1.0.0;escaping=invalid",
		]) {
			assert.equal(
				negotiateContentType(accept, RegistryContentType.Prometheus),
				RegistryContentType.Prometheus,
			);
		}
	});

	it("is case-insensitive and handles quoted parameters", () => {
		assert.equal(
			negotiateContentType(
				'TEXT/PLAIN; VERSION="0.0.4"',
				RegistryContentType.OpenMetricsV1,
			),
			RegistryContentType.Prometheus,
		);
	});
});

describe("buildHttpMetrics", () => {
	it("builds the standard HTTP metrics", () => {
		const { requestDuration, requestsTotal } = buildHttpMetrics();
		assert.equal(requestDuration.name, "http_request_duration_seconds");
		assert.equal(requestDuration.unit, "seconds");
		assert.deepEqual(requestDuration.labelNames, [
			"method",
			"route",
			"status",
			"ok",
		]);
		assert.equal(requestsTotal.name, "http_requests_total");
		assert.deepEqual(requestsTotal.labelNames, [
			"method",
			"route",
			"status",
			"ok",
		]);
	});

	it("applies the prefix as a namespace", () => {
		const { requestDuration, requestsTotal } = buildHttpMetrics({
			prefix: "api",
		});
		assert.equal(requestDuration.name, "api_http_request_duration_seconds");
		assert.equal(requestsTotal.name, "api_http_requests_total");
	});

	it("uses the OpenTelemetry duration buckets", () => {
		const { requestDuration } = buildHttpMetrics();
		requestDuration.observe({}, 0.001);
		const [entry] = [...requestDuration.getValues()];
		assert.deepEqual(
			[...entry.bucketValues.keys()],
			[
				0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5,
				10,
			],
		);
	});
});

describe("createMiddlewareHelper", () => {
	it("uses an isolated registry by default", () => {
		const first = createMiddlewareHelper();
		const second = createMiddlewareHelper();
		assert.notEqual(first.registry, second.registry);
		assert.equal(first.registry.contentType, RegistryContentType.Prometheus);
	});

	it("uses the provided registry and registers the HTTP metrics", async () => {
		const registry = new Registry({ contentType: "OpenMetricsV1" });
		const helper = createMiddlewareHelper({ registry });
		assert.equal(helper.registry, registry);
		helper.startRequest()({
			method: "GET",
			route: "/",
			status: 200,
			ok: "true",
		});
		const body = await registry.getMetrics();
		assert.ok(body.includes("# TYPE http_requests_total counter\n"));
		assert.ok(
			body.includes("# TYPE http_request_duration_seconds histogram\n"),
		);
	});

	it("matches only GET requests for the metrics path", () => {
		const helper = createMiddlewareHelper();
		assert.ok(helper.isMetricsRequest("GET", "/metrics"));
		assert.ok(!helper.isMetricsRequest("POST", "/metrics"));
		assert.ok(!helper.isMetricsRequest("GET", "/metrics/"));
		assert.ok(!helper.isMetricsRequest("GET", "/other"));
	});

	it("honors a custom metrics path", () => {
		const helper = createMiddlewareHelper({ metricsPath: "/internal/metrics" });
		assert.ok(helper.isMetricsRequest("GET", "/internal/metrics"));
		assert.ok(!helper.isMetricsRequest("GET", "/metrics"));
	});

	it("renders Prometheus text by default", async () => {
		const helper = createMiddlewareHelper();
		helper.startRequest()({
			method: "GET",
			route: "/",
			status: 200,
			ok: "true",
		});
		const { body, contentType } = await helper.renderMetrics(undefined);
		assert.equal(contentType, RegistryContentType.Prometheus);
		assert.ok(body.includes("# TYPE http_requests_total counter\n"));
		assert.ok(!body.includes("# EOF"));
	});

	it("renders OpenMetrics with the escaping parameter", async () => {
		const helper = createMiddlewareHelper();
		const { body, contentType } = await helper.renderMetrics(
			"application/openmetrics-text;version=1.0.0",
		);
		assert.equal(contentType, openMetricsHeader);
		assert.ok(body.endsWith("# EOF\n"));
	});

	it("does not mutate the registry content type", async () => {
		const registry = new Registry();
		const helper = createMiddlewareHelper({ registry });
		await helper.renderMetrics("application/openmetrics-text;version=1.0.0");
		assert.equal(registry.contentType, RegistryContentType.Prometheus);
		assert.ok(!(await registry.getMetrics()).includes("# EOF"));
	});

	it("can render OpenMetrics-only metrics", async () => {
		const registry = new Registry();
		const info = new Info({ name: "build", help: "Build information" });
		registry.register(info);
		info.set({ version: "1" });
		const helper = createMiddlewareHelper({ registry });
		const { body } = await helper.renderMetrics(
			"application/openmetrics-text;version=1.0.0",
		);
		assert.ok(body.includes('build_info{version="1"} 1\n'));
		await assert.rejects(
			registry.getMetrics(),
			/Info metric is only supported/,
		);
	});

	it("records request counts and durations", async () => {
		const helper = createMiddlewareHelper();
		helper.startRequest()({
			method: "GET",
			route: "/users/:id",
			status: 200,
			ok: "true",
		});
		const body = await helper.registry.getMetrics();
		const labels = 'method="GET",route="/users/:id",status="200",ok="true"';
		assert.ok(body.includes(`http_requests_total{${labels}} 1\n`));
		assert.ok(
			body.includes(`http_request_duration_seconds_count{${labels}} 1\n`),
		);
		assert.ok(
			body.includes(
				`http_request_duration_seconds_bucket{le="+Inf",${labels}} 1\n`,
			),
		);
	});

	it("accumulates multiple requests", async () => {
		const helper = createMiddlewareHelper();
		const result = {
			method: "GET",
			route: "/users/:id",
			status: 200,
			ok: "true",
		};
		helper.startRequest()(result);
		helper.startRequest()(result);
		const body = await helper.registry.getMetrics();
		const labels = 'method="GET",route="/users/:id",status="200",ok="true"';
		assert.ok(body.includes(`http_requests_total{${labels}} 2\n`));
		assert.ok(
			body.includes(`http_request_duration_seconds_count{${labels}} 2\n`),
		);
	});

	it("derives the ok label from the status", async () => {
		const helper = createMiddlewareHelper();
		helper.startRequest()({
			method: "GET",
			route: "/failure",
			status: 500,
			ok: "true",
		});
		const body = await helper.registry.getMetrics();
		assert.ok(
			body.includes(
				'http_requests_total{method="GET",route="/failure",status="500",ok="false"} 1\n',
			),
		);
	});
});
