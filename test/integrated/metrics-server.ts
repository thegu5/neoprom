import http from "node:http";
import { Counter, Registry } from "../../src/index.ts";

const registry = new Registry();
const counter = new Counter({
	name: "neoprom_test_total",
	help: "test counter",
});
registry.register(counter);
counter.inc();

http
	.createServer(async (req, res) => {
		if (req.url === "/metrics") {
			res.writeHead(200, { "content-type": registry.contentType });
			res.end(await registry.getMetrics());
			return;
		}
		res.writeHead(404);
		res.end();
	})
	.listen(9000, "0.0.0.0");
