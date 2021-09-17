import { AddFileOutput, AssetGet, BC_PermissionLevel, Connect, Init, JMod, logConfig, logger, LogLevel, SetConsoleOutput } from "bondage-club-bot-api";

import { MaidsPartyNightSinglePlayerAdventure } from "./logic/maidsPartyNightSinglePlayerAdventure";
import { KNOWN_TROLL_LIST, SUPERUSERS } from "./config";
import { accounts } from "./secrets";

import fs from "fs";
import { initMetrics } from "./metrics";

SetConsoleOutput(LogLevel.VERBOSE);

const time = new Date();
const timestring = `${time.getFullYear() % 100}${(time.getMonth() + 1).toString().padStart(2, "0")}${time.getDate().toString().padStart(2, "0")}_` +
	`${time.getHours().toString().padStart(2, "0")}${time.getMinutes().toString().padStart(2, "0")}`;
const logPrefix = `${timestring}_${process.pid}`;

fs.mkdirSync("./data/logs/maidspartynight", { recursive: true });
AddFileOutput(`./data/logs/maidspartynight/${logPrefix}_debug.log`, false, LogLevel.DEBUG);
AddFileOutput(`./data/logs/maidspartynight/${logPrefix}_error.log`, true, LogLevel.ALERT);

let conn: API_Connector | null = null;
let conn2: API_Connector | null = null;
let testLogic: MaidsPartyNightSinglePlayerAdventure | null = null;

const defaultBotAppearance = JMod.JMod_importAppearanceBundle(
	"NobwRAcghgtgpmAXGASnA5gVwDZQE5gA0YA4ngPaYAOSYAspQC4AWRYAwuduQYsGAGIAogHYRAMQlgAugF9C4aPFoAFTAGd1ATwAyAS3TNGARjZlKNZGs1aw8xbATIAQtg2ti56rVfu7CyEdacTc9ABN1MwpvZBDMcMj7QOVkIRhyRj0AY3IAOyiLWjSM7Lz/BxSwIS04ACMKAHd1U09oyyqa+vIm8uSnMAAROAAzKBxGApiwAAkoXIjepX6h0fHJ9um4KDDFoOQIPSoqbDhm9doDo5PEgKWimuaAJnPUh7ZObl5BAGZvqChfrtKtVTsZnq1Cq9TuCOFweLQBL9/oCkndkNMAAwATgALBiXjM4AYjED+gBlGBQbDYAnOchhLQAVSOcAIxA+8OQAHVmHpGAhUXswBSqTSIVM6QydN1WaTaLM9HhxBRciYCQqlSqJuy4V8BAA2AH6x4ADjl6KgiucUCyAGsWqQ2vLLXhrXbzcLGJgwnBVQB5TCMYZ8mFedrsbgsd66pD8ATGLEJhMyQWVHRQfkADzJ5DtZ3F7Rzeejn1jgmMOIrFZTtyFdIy+cdkOFzHIpxLnLjGIArD2e2wBH3e92B8YAIJJrE1ir9ZysuBqgvO7Ww0t8cv64yb/XTvq0Mlen3+wPBxjfOkNB1h2gRjLMMdZLKndQ8Ww6tdx74ic9f3dosAAJKqqyNqZAAbnAABqegvmyTZTAB/IwJs2wdrwcbdvqQjOL2MjECoFBUKyjC2Ig4AACpaERSC5Dg2DEEIwzDHAWQTHwcipv0GohDKeBXk6FqKg+T6aK+3xoWWiLfiav5yLWaYZnAmZCNgtTdCQ3AQZES7IBp5BaRJ65SY8Jk4n+QriIGmB4DBmRZHQfL8rk2nwe0iFwMhcwLO+naCJWOKPJWA7nhIjzsKOzjGJFzhsCsYzYBM0j4YRxGkRRVH9HpBnEAMehMdk4ykRiDFMSxbHAElwpwNgwyMrk3DuogjB4JgcCyLI0hAA="
);

async function run() {
	initMetrics(8010, "maidspartynight");

	[conn, conn2] = await Promise.all([
		Connect(...accounts[0]),
		Connect(...accounts[1])
	]);

	// @ts-ignore: dev
	global.conn = conn;
	// @ts-ignore: dev
	global.conn2 = conn2;

	// @ts-ignore: dev
	global.AssetGet = AssetGet;

	if (!JMod.JMod_applyAppearanceBundle(conn.Player, defaultBotAppearance) || !JMod.JMod_applyAppearanceBundle(conn2.Player, defaultBotAppearance)) {
		logger.warning("Failed to reset bot appearance!");
	}

	conn.Player.SetItemPermission(BC_PermissionLevel.Owner);

	conn2.Player.SetItemPermission(BC_PermissionLevel.Owner);

	testLogic = new MaidsPartyNightSinglePlayerAdventure(conn, conn2);
	conn.logic = testLogic;
	// @ts-ignore: dev
	global.logic = testLogic;

	await conn.ChatRoomJoinOrCreate(
		{
			Name: "A maids party night",
			Description: "[BOT] scripted room singleplayer adventure | version 2021-04-05",
			Background: "SynthWave",
			Limit: 2,
			Private: true,
			Locked: false,
			Admin: [conn.Player.MemberNumber, conn2.Player.MemberNumber, ...SUPERUSERS],
			Ban: [...KNOWN_TROLL_LIST],
			Game: "",
			BlockCategory: []
		}
	);
	logger.alert("Ready!");
}

Init()
	.then(run, err => {
		logger.fatal("Asset loading rejected:", err);
	})
	.catch(err => {
		logger.fatal("Error while running:", err);
	});

logConfig.onFatal.push(() => {
	conn?.disconnect();
	conn = null;
	conn2?.disconnect();
	conn2 = null;
	testLogic?.destroy();
	testLogic = null;
});
