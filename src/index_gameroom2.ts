import { AssetGet, BC_PermissionLevel, Connect, Init, JMod, logConfig, logger } from "bondage-club-bot-api";

import { RoleplaychallengeGameRoom } from "./logic/roleplaychallengeGameRoom";
import { KNOWN_TROLL_LIST, SUPERUSERS } from "./config";
import { accounts } from "./secrets";

import { initMetrics } from "./metrics";
import { setupLogging } from "./utils";

setupLogging("gameroom2");

let conn: API_Connector | null = null;
let testLogic: RoleplaychallengeGameRoom | null = null;

const defaultBotAppearance = JMod.JMod_importAppearanceBundle(
	"NobwRAcghgtgpmAXGASnA5gVwDZQE5gA0YA4ngPaYAOSYAspQC4AWRYAwuduQYsGAGIAogHYRAMQlgAugF9C4aPFoAFTAGd1ATwAyAS3TNGARjZlKNZGs1aw8xbATIAQtg2ti56rVfu7CyEdacTc9ABN1MwpvZBDMcMj7QOVkIRhyRj0AY3IAOyiLWjSM7Lz/BxSwIS04ACMKAHd1U09oyyqa+vIm8uSnMAAROAAzKBxGApiwAAkoXIjepX6h0fHJ9um4KDDFoOQIPSoqbDhm9doDo5PEgKWimuaAJnPUh7ZObl5BAGZvqChfrtKtVTsZnq1Cq9TuCOFweLQBL9/oCkndkNMAAwATgALBiXjM4AYjED+gBlGBQbDYAnOchhLQAVSOcAIxA+8OQAHVmHpGAhUXswBSqTSIVM6QydN1WaTaLM9HhxBRciYCQqlSqJuy4V8BAA2AH6x4ADjl6KgiucUCyAGsWqQ2vLLXhrXbzcLGJgwnBVQB5TCMYZ8mFedrsbgsd66pD8ATGLEJhMyQWVHRQfkADzJ5DtZ3F7Rzeejn1jgmMOIrFZTtyFdIy+cdkOFzHIpxLnLjGIArD2e2wBH3e92B8YAIJJrE1ir9ZysuBqgvO7Ww0t8cv64yb/XTvq0Mlen3+wPBxjfOkNB1h2gRjLMMdZLKndQ8Ww6tdx74ic9f3dosAAJKqqyNqZAAbnAABqegvmyTZTAB/IwJs2wdrwcbdvqQjOL2MjECoFBUKyjC2Ig4AACpaERSC5Dg2DEEIwzDHAWQTHwcipv0GohDKeBXk6FqKg+T6aK+3xoWWiLfiav5yLWaYZnAmZCNgtTdCQ3AQZES7IBp5BaRJ65SY8Jk4n+QriIGmB4DBmRZHQfL8rk2nwe0iFwMhcwLO+naCJWOKPJWA7nhIjzsKOzjGJFzhsCsYzYBM0j4YRxGkRRVH9HpBnEAMehMdk4ykRiDFMSxbHAElwpwNgwyMrk3DuogjB4JgcCyLI0hAA="
);

async function run() {
	initMetrics(8012, "roleplaychallenge");

	conn = await Connect(...accounts[3]);

	// @ts-ignore: dev
	global.conn = conn;

	// @ts-ignore: dev
	global.AssetGet = AssetGet;

	if (!JMod.JMod_applyAppearanceBundle(conn.Player, defaultBotAppearance)) {
		logger.warning("Failed to reset bot appearance!");
	}
	conn.Player.SetExpression("Mouth", "Smirk");

	conn.Player.SetItemPermission(BC_PermissionLevel.Owner);
	conn.Player.FriendListAdd(...SUPERUSERS);
	conn.Player.SetDescription(RoleplaychallengeGameRoom.description);

	// const testLogic = new MagicStrageRoom(conn);
	testLogic = new RoleplaychallengeGameRoom(conn);
	conn.logic = testLogic;
	// @ts-ignore: dev
	global.logic = testLogic;

	await conn.ChatRoomJoinOrCreate(
		{
			Name: "Roleplay challenge",
			Description: "[BOT] scripted multiplayer game room | manual in bot profile | READY",
			Background: "CollegeTheater",
			Limit: 7,
			Private: false,
			Locked: false,
			Admin: [conn.Player.MemberNumber, ...SUPERUSERS],
			Ban: [...KNOWN_TROLL_LIST],
			Game: "",
			BlockCategory: []
		}
	);
	await conn.Player.MoveToPos(0);
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
	testLogic?.destroy();
	testLogic = null;
});
