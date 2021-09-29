import { AddFileOutput, logConfig, logger, LogLevel, SetConsoleOutput } from "bondage-club-bot-api";
import { DISCORD_WEBHOOK } from "./secrets";

import * as fs from "fs";
import { RESTPostAPIWebhookWithTokenJSONBody } from "discord-api-types/v9";
import axios from "axios";

/**
 * Waits for set amount of time, returning promes
 * @param ms The time in ms to wait for
 */
export function wait(ms: number): Promise<void> {
	return new Promise(r => setTimeout(r, ms));
}

/**
 * Shuffles an array in-place
 * @param array The array to shuffle
 */
export function shuffleArray(array: any[]) {
	for (let i = array.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[array[i], array[j]] = [array[j], array[i]];
	}
}

/** Custom function for stringifying data when logging into file */
function anyToString(data: unknown): string {
	if (typeof data === "string") {
		return data;
	}

	if (typeof data === "object" && data !== null && !Array.isArray(data)) {
		if (data instanceof Error) {
			return data.stack ? `[${data.stack}\n]` : `[Error ${data.name}: ${data.message}]`;
		}
		const customString = String(data);
		if (customString !== "[object Object]") {
			return customString;
		}
	}

	return (
		JSON.stringify(data, (k, v) => {
			if (typeof v === "object" && v !== null && v !== data) {
				return Array.isArray(v) ? "[object Array]" : String(v);
			}
			// eslint-disable-next-line @typescript-eslint/no-unsafe-return
			return v;
		}) ?? "undefined"
	);
}

export function setupLogging(identifier: string) {
	SetConsoleOutput(LogLevel.VERBOSE);

	const time = new Date();
	const timestring = `${time.getFullYear() % 100}${(time.getMonth() + 1).toString().padStart(2, "0")}${time.getDate().toString().padStart(2, "0")}_` +
		`${time.getHours().toString().padStart(2, "0")}${time.getMinutes().toString().padStart(2, "0")}`;
	const logPrefix = `${timestring}_${process.pid}`;

	fs.mkdirSync(`./data/logs/${identifier}`, { recursive: true });
	AddFileOutput(`./data/logs/${identifier}/${logPrefix}_debug.log`, false, LogLevel.DEBUG);
	AddFileOutput(`./data/logs/${identifier}/${logPrefix}_error.log`, true, LogLevel.ALERT);

	if (DISCORD_WEBHOOK) {
		let suspend: boolean = false;
		logConfig.logOutputs.push({
			logLevel: LogLevel.ALERT,
			logLevelOverrides: {},
			supportsColor: false,
			onMessage: (prefix, message) => {
				if (suspend)
					return;
				const LOG_COLORS = {
					" FATAL ": 0x581845,
					" ERROR ": 0xC70039,
					"WARNING": 0xFF5733,
					"ALERT  ": 0xFFC300
				};
				const color = (Object.entries(LOG_COLORS).find(i => prefix.includes(i[0])) || ["", 0xFFC300])[1];
				const line = message.map((v) => anyToString(v)).join(" ") + "\n";
				const request: RESTPostAPIWebhookWithTokenJSONBody = {
					embeds: [{
						author: {
							name: identifier
						},
						color,
						title: prefix,
						description: `\`\`\`\n${line}\n\`\`\``
					}]
				};
				axios.post(DISCORD_WEBHOOK, request).catch(err => {
					suspend = true;
					logger.error("Failed to send discord webhook error", err);
					suspend = false;
				});
			}
		});
	}
}
