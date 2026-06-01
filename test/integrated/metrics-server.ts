import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { Gauge, globalRegistry, Histogram } from "../../src/index.ts";

new Gauge({
	name: "collectors_ready",
	help: "Number of active collectors",
}).inc();

const hist = new Histogram({
	name: "bweh_hist",
	help: ".",
});
hist.observe(-1);
hist.observe(0);
hist.observe(0.5);
hist.observe(5);

const app = new Hono();

app.get("/metrics", async () => {
	return new Response(await globalRegistry.getMetrics(), {
		headers: {
			"Content-Type": globalRegistry.contentType,
		},
	});
});

serve({
	fetch: app.fetch,
	port: 9000,
});
