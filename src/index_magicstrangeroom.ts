import { AssetGet, BC_PermissionLevel, Connect, Init, JMod, logConfig, logger } from "bondage-club-bot-api";

import { MagicStrangeRoom } from "./logic/magicStrangeRoom";
import { KNOWN_TROLL_LIST, SUPERUSERS } from "./config";
import { accounts } from "./secrets";

import { initMetrics } from "./metrics";
import { setupLogging } from "./utils";

setupLogging("magicstrangeroom");

let conn: API_Connector | null = null;
let testLogic: MagicStrangeRoom | null = null;

const defaultBotAppearance = JMod.JMod_importAppearanceBundle(
	"NobwRAcghgtgpmAXGASnA5gVwDZQE5gA0YA4ngPaYAOSYAspQC4AWRYAwuduQYsGAGIAogHYRAMQlgAugF9C4aPFoAFTAGd1ATwAyAS3TNGARjZlKNZGs1aw8xbATIAQtg2ti56rVfu7CyEdacTc9ABN1MwpvZBDMcMj7QOVkIRhyRj0AY3IAOyiLWjSM7Lz/BxSwIS04ACMKAHd1U09oyyqa+vIm8uSnMAAROAAzKBxGApiwAAkoXIjepX6h0fHJ9um4KDDFoOQIPSoqbDhm9doDo5PEgKWimuaAJnPUh7ZObl5BAGZvqChfrtKtVTsZnq1Cq9TuCOFweLQBL9/oCkndkNMAAwATgALBiXjM4AYjED+gBlGBQbDYAnOchhLQAVSOcAIxA+8OQAHVmHpGAhUXswBSqTSIVM6QydN1WaTaLM9HhxBRciYCQqlSqJuy4V8BAA2AH6x4ADjl6KgiucUCyAGsWqQ2vLLXhrXbzcLGJgwnBVQB5TCMYZ8mFedrsbgsd66pD8ATGLEJhMyQWVHRQfkADzJ5DtZ3F7Rzeejn1jgmMOIrFZTtyFdIy+cdkOFzHIpxLnLjGIArD2e2wBH3e92B8YAIJJrE1ir9ZysuBqgvO7Ww0t8cv64yb/XTvq0Mlen3+wPBxjfOkNB1h2gRjLMMdZLKndQ8Ww6tdx74ic9f3dosAAJKqqyNqZAAbnAABqegvmyTZTAB/IwJs2wdrwcbdvqQjOL2MjECoFBUKyjC2Ig4AACpaERSC5Dg2DEEIwzDHAWQTHwcipv0GohDKeBXk6FqKg+T6aK+3xoWWiLfiav5yLWaYZnAmZCNgtTdCQ3AQZES7IBp5BaRJ65SY8Jk4n+QriIGmB4DBmRZHQfL8rk2nwe0iFwMhcwLO+naCJWOKPJWA7nhIjzsKOzjGJFzhsCsYzYBM0j4YRxGkRRVH9HpBnEAMehMdk4ykRiDFMSxbHAElwpwNgwyMrk3DuogjB4JgcCyLI0hAA="
);

async function run() {
	initMetrics(8010, "magicstrangeroom");

	const acc = accounts.magicstrangeroom;
	conn = await Connect(...acc);

	// @ts-ignore: dev
	global.conn = conn;

	// @ts-ignore: dev
	global.AssetGet = AssetGet;

	if (!JMod.JMod_applyAppearanceBundle(conn.Player, defaultBotAppearance)) {
		logger.warning("Failed to reset bot appearance!");
	}

	conn.Player.SetItemPermission(BC_PermissionLevel.Owner);
	conn.Player.SetInvisible(true);

	testLogic = new MagicStrangeRoom(conn);
	conn.logic = testLogic;
	// @ts-ignore: dev
	global.logic = testLogic;

	await conn.ChatRoomJoinOrCreate(
		{
			Name: "Magic strange room",
			Description: "[BOT] scripted room singleplayer adventure | version 2021-11-13",
			Background: "AlchemistOffice",
			Limit: 3,
			Private: true,
			Locked: false,
			Admin: [conn.Player.MemberNumber, ...SUPERUSERS],
			Ban: [...KNOWN_TROLL_LIST],
			Game: "",
			BlockCategory: ["Leashing"]
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
	conn?.Player.SetInvisible(false);
	conn?.disconnect();
	conn = null;
	testLogic = null;
});