import { GetLogger, Logger } from "bondage-club-bot-api";
import { AssetGet, BC_PermissionLevel, Connect, Init, JMod, logConfig, logger } from "bondage-club-bot-api";

import { IwouldnotmindGameRoom } from "./logic/iwouldnotmindGameRoom";
import { KNOWN_TROLL_LIST, SUPERUSERS } from "./config";
import { accounts } from "./secrets";

import { initMetrics } from "./metrics";
import { setupLogging } from "./utils";
import { RoleplaychallengeGameRoom } from "./logic/roleplaychallengeGameRoom";
import { KidnappersGameRoom } from "./logic/kidnappersGameRoom";

export interface ISchedulerLogic extends BC_Logic {
	roomCanShutDown(): boolean;
	destroy(): void;
}

export interface ISchedulerOptions {
	logic: new (conn: API_Connector) => ISchedulerLogic;
	account: readonly [string, string];
	room: Readonly<{
		Name: string;
		Description: string;
		Background: string;
		Limit: number;
	}>;
	characterDescription: string;
	condition: () => boolean;
}

const DEFAULT_BOT_APPEARANCE = JMod.JMod_importAppearanceBundle(
	"NobwRAcghgtgpmAXGASnA5gVwDZQE5gA0YA4ngPaYAOSYAspQC4AWRYAwuduQYsGAGIAogHYRAMQlgAugF9C4aPFoAFTAGd1ATwAyAS3TNGARjZlKNZGs1aw8xbATIAQtg2ti56rVfu7CyEdacTc9ABN1MwpvZBDMcMj7QOVkIRhyRj0AY3IAOyiLWjSM7Lz/BxSwIS04ACMKAHd1U09oyyqa+vIm8uSnMAAROAAzKBxGApiwAAkoXIjepX6h0fHJ9um4KDDFoOQIPSoqbDhm9doDo5PEgKWimuaAJnPUh7ZObl5BAGZvqChfrtKtVTsZnq1Cq9TuCOFweLQBL9/oCkndkNMAAwATgALBiXjM4AYjED+gBlGBQbDYAnOchhLQAVSOcAIxA+8OQAHVmHpGAhUXswBSqTSIVM6QydN1WaTaLM9HhxBRciYCQqlSqJuy4V8BAA2AH6x4ADjl6KgiucUCyAGsWqQ2vLLXhrXbzcLGJgwnBVQB5TCMYZ8mFedrsbgsd66pD8ATGLEJhMyQWVHRQfkADzJ5DtZ3F7Rzeejn1jgmMOIrFZTtyFdIy+cdkOFzHIpxLnLjGIArD2e2wBH3e92B8YAIJJrE1ir9ZysuBqgvO7Ww0t8cv64yb/XTvq0Mlen3+wPBxjfOkNB1h2gRjLMMdZLKndQ8Ww6tdx74ic9f3dosAAJKqqyNqZAAbnAABqegvmyTZTAB/IwJs2wdrwcbdvqQjOL2MjECoFBUKyjC2Ig4AACpaERSC5Dg2DEEIwzDHAWQTHwcipv0GohDKeBXk6FqKg+T6aK+3xoWWiLfiav5yLWaYZnAmZCNgtTdCQ3AQZES7IBp5BaRJ65SY8Jk4n+QriIGmB4DBmRZHQfL8rk2nwe0iFwMhcwLO+naCJWOKPJWA7nhIjzsKOzjGJFzhsCsYzYBM0j4YRxGkRRVH9HpBnEAMehMdk4ykRiDFMSxbHAElwpwNgwyMrk3DuogjB4JgcCyLI0hAA="
);

export class BotroomScheduler {
	readonly options: Readonly<ISchedulerOptions>;
	readonly logger: Logger;
	private timer: NodeJS.Timeout | null = null;

	constructor(options: ISchedulerOptions) {
		this.options = options;
		this.logger = GetLogger("Scheduler", `[Scheduler ${options.room.Name}]`);
		this.timer = setInterval(this.tick.bind(this), 10_000);
		logConfig.onFatal.push(() => {
			if (this.timer !== null) {
				clearInterval(this.timer);
				this.timer = null;
			}
			if (this.started) {
				this.stop();
			}
		});
	}

	private started: boolean = false;
	private logic: ISchedulerLogic | null = null;
	private connection: API_Connector | null = null;

	private tick() {
		const requested = this.options.condition();
		if (requested && !this.started) {
			this.start()
				.catch((err) => this.logger.fatal("Failed to start", err));
		}
		if (!requested && this.started && (!this.logic || this.logic.roomCanShutDown())) {
			this.stop();
		}
	}

	private stop() {
		this.logger.alert("Stopping");
		if (this.logic) {
			this.logic.destroy();
			this.logic = null;
		}
		if (this.connection) {
			this.connection.logic = null;
			this.connection.ChatRoomLeave();
			this.connection.disconnect();
			this.connection = null;
		}
		this.started = false;
	}

	private async start() {
		if (this.started || this.logic || this.connection)
			return;
		this.logger.alert("Starting");
		this.started = true;
		this.connection = await Connect(...this.options.account);

		if (!JMod.JMod_applyAppearanceBundle(this.connection.Player, DEFAULT_BOT_APPEARANCE)) {
			logger.warning("Failed to reset bot appearance!");
		}
		this.connection.Player.SetExpression("Mouth", "Smirk");

		this.connection.Player.SetItemPermission(BC_PermissionLevel.Owner);
		this.connection.Player.FriendListAdd(...SUPERUSERS);
		this.connection.Player.SetDescription(this.options.characterDescription);

		this.logic = new this.options.logic(this.connection);
		this.connection.logic = this.logic;

		await this.connection.ChatRoomJoinOrCreate(
			{
				...this.options.room,
				Private: false,
				Locked: false,
				Admin: [this.connection.Player.MemberNumber, ...SUPERUSERS],
				Ban: [...KNOWN_TROLL_LIST],
				Game: "",
				BlockCategory: ["Leashing"]
			}
		);
		await this.connection.Player.MoveToPos(0);
		this.logger.alert("Ready");
	}
}

setupLogging("scheduler");

const schedulers: BotroomScheduler[] = [];

function run() {
	initMetrics(8011, "scheduler");

	// @ts-ignore: dev
	global.AssetGet = AssetGet;

	schedulers.push(new BotroomScheduler({
		logic: IwouldnotmindGameRoom,
		account: accounts.iwouldnotmind as [string, string],
		room: {
			Name: "I would not mind",
			Description: "[BOT] scripted multiplayer gameroom | manual in bot profile",
			Background: "SheikhPrivate",
			Limit: 7
		},
		characterDescription: IwouldnotmindGameRoom.description,
		condition: () => [1, 5, 6].includes(new Date().getUTCDay())
	}));
	schedulers.push(new BotroomScheduler({
		logic: RoleplaychallengeGameRoom,
		account: accounts.roleplaychallenge as [string, string],
		room: {
			Name: "Roleplay challenge",
			Description: "[BOT] scripted multiplayer game room | manual in bot profile | READY",
			Background: "CollegeTheater",
			Limit: 7
		},
		characterDescription: RoleplaychallengeGameRoom.description,
		condition: () => [0, 2, 4].includes(new Date().getUTCDay())
	}));
	schedulers.push(new BotroomScheduler({
		logic: KidnappersGameRoom,
		account: accounts.kidnappers as [string, string],
		room: {
			Name: "Kidnappers",
			Description: "[BOT] scripted multiplayer gameroom | manual in bot profile",
			Background: "MainHall",
			Limit: 10
		},
		characterDescription: KidnappersGameRoom.description,
		condition: () => [0, 3, 6].includes(new Date().getUTCDay())
	}));

	logger.alert("Ready!");
}

Init()
	.then(run, err => {
		logger.fatal("Asset loading rejected:", err);
	})
	.catch(err => {
		logger.fatal("Error while running:", err);
	});
