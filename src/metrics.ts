import { logConfig, logger } from "bondage-club-bot-api";

import express from "express";
import http from "http";
import promClient from "prom-client";

export function initMetrics(port: number, label: string) {
	promClient.register.setDefaultLabels({
		app: "hub",
		hubroom: label
	});
	promClient.collectDefaultMetrics({
		prefix: "hub_"
	});

	const app = express();

	app.get("/metrics", (req, res) => {
		res.set("Content-Type", promClient.register.contentType);
		promClient.register.metrics().then(
			data => res.end(data),
			err => res.status(500).end(err)
		);
	});

	const server = http.createServer(app).listen(port, "0.0.0.0", () => {
		logger.info("Metrics server ready!");
	});

	logConfig.onFatal.push(() => {
		server.close(() => {
			logger.debug("Metrics server closed");
		});
	});
}
