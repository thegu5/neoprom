import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Hono } from "hono";
import { prometheus } from "../../src/middleware/hono.ts";
import { RegistryContentType } from "../../src/registry.ts";

function createApp() {
	const app = new Hono();
	app.use(prometheus());
	app.get("/users/:id", (c) => c.text("Hello!"));
	app.post("/users", (c) => c.text("Created", 201));
	app.get("/failure", () => {
		throw new Error("Failure");
	});
	app.onError((error, c) => c.text(error.stack ?? error.message, 503));
	return app;
}

async function scrape(app: Hono) {
	const response = await app.request("/metrics");
	const body = await response.text();
	assert.equal(response.status, 200, body);
	return { response, body };
}

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
				'http_requests_total{method="POST",route="/users",status="201",ok="true"} 1\n',
			),
		);
		assert.ok(!body.includes("/users/123"));
	});

	it("groups unmatched routes and records handled errors", async () => {
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
});
