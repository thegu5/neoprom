import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import express, {
	type NextFunction,
	type Request,
	type Response,
} from "express";
import { prometheus } from "../../src/middleware/express.ts";
import { RegistryContentType } from "../../src/registry.ts";

function createApp() {
	const app = express();
	app.use(prometheus());
	app.get("/users/:id", (_req, res) => {
		res.send("Hello!");
	});
	app.post("/users", (_req, res) => {
		res.status(201).send("Created");
	});
	app.get("/failure", () => {
		throw new Error("Failure");
	});
	app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
		res.status(503).send(error.stack ?? error.message);
	});
	return app;
}

type App = ReturnType<typeof createApp>;

async function withServer<T>(
	app: App,
	callback: (baseUrl: string) => Promise<T>,
) {
	const server: Server = app.listen(0);
	await new Promise<void>((resolve) => server.once("listening", resolve));
	const { port } = server.address() as AddressInfo;
	try {
		return await callback(`http://127.0.0.1:${port}`);
	} finally {
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
	}
}

async function scrape(baseUrl: string, expected?: string) {
	for (let attempt = 0; ; attempt++) {
		const response = await fetch(`${baseUrl}/metrics`);
		const body = await response.text();
		assert.equal(response.status, 200, body);
		if (!expected || body.includes(expected) || attempt >= 50) {
			return { response, body };
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

describe("Express middleware", () => {
	it("collects counts and durations using route templates", async () => {
		const app = createApp();
		await withServer(app, async (baseUrl) => {
			await fetch(`${baseUrl}/users/123?ignored=true`);
			await fetch(`${baseUrl}/users/456`);
			await fetch(`${baseUrl}/users`, { method: "POST" });
			const labels = 'method="GET",route="/users/:id",status="200",ok="true"';
			const { response, body } = await scrape(
				baseUrl,
				`http_requests_total{${labels}} 2\n`,
			);
			assert.equal(
				response.headers.get("Content-Type"),
				RegistryContentType.Prometheus,
			);
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
	});

	it("groups unmatched routes and records handled errors", async () => {
		const app = createApp();
		await withServer(app, async (baseUrl) => {
			assert.equal((await fetch(`${baseUrl}/failure`)).status, 503);
			await fetch(`${baseUrl}/missing-one`);
			await fetch(`${baseUrl}/missing-two`);
			const { body } = await scrape(
				baseUrl,
				'http_requests_total{method="GET",route="*",status="404",ok="false"} 2\n',
			);
			assert.ok(
				body.includes(
					'http_requests_total{method="GET",route="/failure",status="503",ok="false"} 1\n',
				),
			);
		});
	});
});
