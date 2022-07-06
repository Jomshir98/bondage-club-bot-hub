
//  ----------------------------------------------
//   W  O  R  K            -----------------------
//                 I  N
//  -----------            P  R  O  G  R  E  S  S
//  ----------------------------------------------


import { AssetGet, logger, BC_PermissionLevel } from "bondage-club-bot-api";

import { wait } from "../utils";
import { AdministrationLogic } from "./administrationLogic";
import { MatchmakingNotifier } from "../gameroomMatchmaking";

import _ from "lodash";

interface gameConfig {
	players: number;
	mistress: numberOfMistresses;
	m_willpower: number;
	m_dominance: number;
	dice_sides: number;
	turnDuration: number;
	victoryDuration: number;
}

// changing those will break the game's code severely
type numberOfMistresses = 0 | 1;

type GameState =
	| "game_not_started"
	| "player_phase"
	| "mistress_phase"
	| "game_was_won";

type configurationName =
	| "1player"
	| "2players"
	| "3players"
	| "4players";

// TODO: announce the configuration and role distribution in the current game, related to the last parameter

const gameConfigurations: Record<configurationName, Readonly<gameConfig>> = {
	/**
	 * m_willpower
	 * Claudia: with 4 players I need x16
	 * Claudia: with 3 I need x9
	 * Claudia: with 2 I need x4
	 */
	"1player":
	{
		players: 1,
		mistress: 1,
		m_willpower: 120,
		m_dominance: 17,
		dice_sides: 20,
		turnDuration: 30_000,
		victoryDuration: 60_000
	},
	"2players":
	{
		players: 2,
		mistress: 1,
		m_willpower: 240,
		m_dominance: 34,
		dice_sides: 40,
		turnDuration: 30_000,
		victoryDuration: 60_000
	},
	"3players":
	{
		players: 3,
		mistress: 1,
		m_willpower: 360,
		m_dominance: 51,
		dice_sides: 60,
		turnDuration: 30_000,
		victoryDuration: 60_000
	},
	"4players":
	{
		players: 4,
		mistress: 1,
		m_willpower: 480,
		m_dominance: 68,
		dice_sides: 80,
		turnDuration: 30_000,
		victoryDuration: 60_000
	}
};

const listOfUsedItemsInThisScene: ([AssetGroupName, string] | [AssetGroupName, string, string])[] = [
	["ItemArms", "HempRope", "Hogtied"],
	["ItemArms", "HempRope", "BoxTie"],
	["ItemArms", "HempRope", "RopeCuffs"],
	["ItemLegs", "HempRope", "Frogtie"],
	["ItemMouth", "ClothGag", "OTM"],
	["ItemMouth2", "ClothGag", "OTM"],
	["ItemMouth3", "ClothGag", "OTM"]
];

const listOfUsedItemGroups = _.uniq(listOfUsedItemsInThisScene.map(i => i[0]));

/** The matchmaking queue count that triggers a beep message to everyone on it */
const BEEP_AT_THIS_COUNT = 3;

class Boss {
	willpower: number = 0;
	dominance: number = 0;
	boss_stage: number = 1;
}

class Player {
	loseCounter: number = 7;

	public character: API_Character;

	get Name(): string {
		return this.character.Name;
	}

	get MemberNumber(): number {
		return this.character.MemberNumber;
	}

	toString(): string {
		return this.character.toString();
	}

	constructor(character: API_Character) {
		this.character = character;
	}

}

export class MistressTroubleGameRoom extends AdministrationLogic {
	/** The registered players */
	players: Player[] = [];
	mistress: Boss = new Boss();
	gameState: GameState = "game_not_started";
	turnTimer: number = 0;
	gameRound: number = 1;

	simulatedWillpower: number = 0;

	matchmaking_notifier: MatchmakingNotifier;
	/** Block the beepme command when this is true */
	blockMatchmakingJoin: boolean = false;
	/** To be set to true when a match was found */
	beepSuccess: boolean = false;
	/** Timer for blocking the beepme command shortly after a successful match*/
	blockMatchmakingTimer: number = 0;

	private tickTimer: NodeJS.Timeout;

	private charTimer: Map<Player, NodeJS.Timeout> = new Map();

	readonly conn: API_Connector;

	constructor(conn: API_Connector) {
		super({ inactivityKickEnabledOnlyBelowFreeSlotsCount: 7 });
		this.conn = conn;

		this.registerCommand("status", (connection, args, sender) => this.handleStatusCommand(sender), `To get information about the running game`);
		this.registerCommand("joingame", (connection, args, sender) => this.handleJoingameCommand(sender), `To register as a new player`);
		this.registerCommand("freeandleave", (connection, args, sender) => this.handleFreeandleaveCommand(sender), `To urgently leave. Will untie and kick you`);
		this.registerCommand("start", (connection, args, sender) => this.handleStartCommand(sender), `To start a new round after registering`);
		this.registerCommand("simulate", (connection, args, sender) => this.handleSimulateGameCommand(args, sender), null);
		this.registerCommand("beepme", (connection, args, sender) => this.handleBeepmeCommand(sender), `To get beeped when enough players are online`);

		this.matchmaking_notifier = new MatchmakingNotifier(conn, BEEP_AT_THIS_COUNT);

		this.tickTimer = setInterval(this.Tick.bind(this), 1000);
		this.setActiveConfigFromTemplate("1player");
		this.setGameState("game_not_started", false);

		this.mistress.willpower = this.active_config.m_willpower;
		this.mistress.dominance = this.active_config.m_dominance;
	}

	active_config!: gameConfig;

	setActiveConfigFromTemplate(name: configurationName) {
		this.active_config = _.cloneDeep(gameConfigurations[name]);
	}

	getPlayerByCharacter(character: API_Character): Player | null {
		return this.players.find(p => p.character === character) || null;
	}

	/**
	 * The opening note when a player enters the room
	 * @param character the player in question
	 */
	playerGreeting(character: API_Character) {
		character.Tell("Emote", "*Welcome to this game room where we play");
		character.Tell("Chat", "'Mistress Trouble'");
		// TODO: Another great oppurtunity to advertise the bot and add some link to more info in the bot's profile
		character.Tell("Emote", `*a work in progress. It needs one to four players. ` +
			`Please find the manual and the WHISPER commands to participate in the online description / profile ` +
			`of the game's host '${this.conn.Player}'.`
		);
	}

	// Backup of the online description of the bot
	static readonly description = `
MISTRESS TROUBLE
===================================================================
by Claudia, room concept by Claudia & Clare, using Jomshir's BotAPI

The game needs one to four players. 

WORK IN PROGRESS


Contact us
===================================
You can whisper any feedback (including bug reports) for the authors of the room to the bot, by starting your message with '!feedback' (e.g. !feedback I want to tell you that...).
In urgent cases, you can also contact Jomshir, the creator of the bot, on BondageClub discord: Jomshir98#0022

This bot was created using Jomshir's BotAPI.
If you would like to make a bot room similar to this one, you can find all necessary info on the Bondage Club Scripting Community Discord: https://discord.gg/SHJMjEh9VH
`.trim();


	/**
	 * When character enters the room
	 * @param connection Originating connection
	 * @param character The character that entered the room
	 */
	protected async onCharacterEntered(connection: API_Connector, character: API_Character): Promise<void> {
		if (character.IsBot()) return;
		super.onCharacterEntered(connection, character);
		const oldPlayer = this.players.find(p => p.MemberNumber === character.MemberNumber);
		if (oldPlayer) {
			// old player returning
			oldPlayer.character = character;

			const timer = this.charTimer.get(oldPlayer);
			if (timer) {
				clearTimeout(timer);
				this.charTimer.delete(oldPlayer);
			}

			// if (this.chosen_players.has(oldCharacter)) {
			// 	this.chosen_players.delete(oldCharacter);
			// 	this.chosen_players.add(character);
			// }
		} else {
			// new player
			await wait(2000);
			this.playerGreeting(character);
		}
	}

	/**
	 * When character leaves the room
	 * @param connection Originating connection
	 * @param character The character that left the room
	 * @param intentional If the leave was (likely) caused by user
	 */
	protected onCharacterLeft(connection: API_Connector, character: API_Character, intentional: boolean): void {
		if (character.IsBot()) return;
		const player = this.getPlayerByCharacter(character);
		if (player && intentional) {
			this.unregisterPlayer(player, " due to leaving the room.");
		} else if (player && !intentional) {
			this.charTimer.set(player, setTimeout(() => { void this.unregisterPlayer(player, " due to disconnecting."); }, 80_000));
		}
	}

	private unregisterPlayer(player: Player, message: string) {
		const index = this.players.indexOf(player);
		if (index < 0) return;

		this.conn.SendMessage("Emote", `*GAME: ${player} was unregistered as an active player${message}`);
		this.players.splice(index, 1);
		if (this.players.length === 0) {
			this.setGameState("game_not_started");
		}
	}

	handleStatusCommand(sender: API_Character) {
		if (this.gameState === "game_not_started" || this.gameState === "game_was_won") {
			sender.Tell("Whisper", `GAME: Start the next game with !start when enough players have registered using !joingame` +
				`\nThere are ${this.matchmaking_notifier.waitingPlayers > 0 ? `players` : `no players`} in the 'matchmaking ` +
				`queue'. You may want to consider joining the queue with the beepme command to speed up the next match.`
			);
		}
		sender.Tell("Whisper", `The game has the following registered players:\n` +
			this.players.map(A => A.Name).join(", ")
		);
	}

	async handleJoingameCommand(sender: API_Character) {

		if (!sender.ProtectionAllowInteract()) {
			sender.Tell("Chat", `Warning: You are unable to join the game because the bot currently cannot interact with you ` +
				`because your bondage club version is newer than the bot's version.\n` +
				`This might be caused by either you being on beta or the bot not yet being updated to the latest version. ` +
				`If you are using beta, please login using the normal version to enable the bot to interact with you.`
			);
			logger.info(`Player check for ${sender}: Protection: Version=${sender.OnlineSharedSettings.GameVersion}, Admin=${this.conn.Player.IsRoomAdmin()}`);
			return;
		}

		const allow = await sender.GetAllowItem();
		// TODO: Also check if they are untied and allow at least base restraints, otherwise, prevent them from joining
		if (!allow) {
			sender.Tell("Chat", `Warning: You are unable to join the game because the bot cannot interact with you due to ` +
				`your permission settings. Please change them or white list the bot '${this.conn.Player.Name}' and join ` +
				`with !joingame again if you want to play.`
			);
			logger.info(`Player check for ${sender}: Permission level: ` + BC_PermissionLevel[sender.ItemPermission]);
			return;
		}

		if (this.getPlayerByCharacter(sender)) {
			sender.Tell("Whisper", `You are already registered`);
			return;
		}

		const player = new Player(sender);
		this.players.push(player);
		this.conn.SendMessage("Emote", `*GAME: ${sender} was registered as an active player.`);
		this.playerCheck(sender);

		this.beepSuccess = await this.matchmaking_notifier.notifyPlayersOfEnoughInterest(this.players.map(p => p.character));
		if (this.beepSuccess) {
			sender.Tell("Chat", `GAME: You joining the game triggered a matchmaking beep to ${BEEP_AT_THIS_COUNT} players in ` +
				`the waiting queue just now. Please stay around until everyone who was beeped will join the room within the next ` +
				`few minutes in order to start a game. Have fun!~`
			);
		} else if (this.matchmaking_notifier.waitingPlayers > 0) {
			sender.Tell("Chat", `GAME: There ${this.matchmaking_notifier.waitingPlayers > 1 ? `are` : `is`} currently ` +
				`${this.matchmaking_notifier.waitingPlayers} ` +
				`player${this.matchmaking_notifier.waitingPlayers > 1 ? `s` : ``} in the 'matchmaking ` +
				`queue'. At ${BEEP_AT_THIS_COUNT} players in the queue, everyone will be beeped. ` +
				`You may want to consider also joining the queue with the beepme command to speed up the next match.`
			);
		}
	}

	async handleFreeandleaveCommand(sender: API_Character) {
		this.freeCharacterInItemSlots(sender, listOfUsedItemGroups);
		sender.Tell("Whisper", "GAME: Goodbye and all the best!");
		await wait(2500);
		await sender.Kick();
	}

	handleStartCommand(sender: API_Character) {
		const player = this.getPlayerByCharacter(sender);
		if (!player) {
			sender.Tell("Whisper", "GAME: Please register first by writing '!joingame' into the chat.");
			return;
		}

		if (this.gameState !== "game_not_started") {
			sender.Tell("Whisper", "GAME: Cannot start, as a game is currently already in progress. You will be part of the next one.");
			return;
		}

		let config: configurationName;
		if (this.players.length === 1) {
			config = "1player";
		} else if (this.players.length === 2) {
			config = "2players";
		} else if (this.players.length === 3) {
			config = "3players";
		} else if (this.players.length === 4) {
			config = "4players";
		} else {
			logger.error("Illegal number of players.");
			return;
		}
		this.setActiveConfigFromTemplate(config);
		this.players.map(P => this.freeCharacterInItemSlots(P.character, listOfUsedItemGroups));
		this.conn.SendMessage("Emote", `*GAME: It's on! The league started the event. It might be a good idea to take ` +
			`today to get to know the other participants. Maybe one can already sense if someone only acts like an innocent ` +
			`club member and is in reality a mean kidnapper!`
		);
		/* this.conn.SendMessage("Emote", `*GAME: This round is played with the game configuration '${config}' ` +
			`(see bot's profile / online description)`
		); */
		/* if (this.active_config.discloseRolesAtStart) {
			this.conn.SendMessage("Emote", `*GAME: The following secret roles are present:` +
				`\n${this.active_config.kidnapper === 1 ? `1 kidnapper` : `2 kidnappers`}\n` +
				`${this.active_config.mistress === 1 ? `1 mistress\n` : ``}` +
				`${this.active_config.maid === 1 ? `1 maid\n` : ``}` +
				`${this.active_config.stalker === 1 ? `1 stalker\n` : ``}` +
				`${this.active_config.switch === 1 ? `1 switch\n` : ``}` +
				`${this.active_config.fan === 1 ? `1 fan\n` : ``}` +
				`${this.active_config.masochist === 1 ? `1 masochist\n` : ``}`
			);
		} */
		this.setGameState("player_phase");
	}

	async handleBeepmeCommand(sender: API_Character) {
		if (this.blockMatchmakingJoin) {
			sender.Tell("Whisper", `GAME: The beepme command is temporarily deactivated, since the previous 'matchmaking' ` +
				`was successful just now. Please wait until everyone who was beeped will join this room and try the command ` +
				`again in a few minutes, in case not enough players for starting a game will join.`
			);
		} else if (this.gameState === "game_not_started" || this.gameState === "game_was_won") {
			await this.matchmaking_notifier.addPlayerToTheMatchmakingQueue(sender);
			this.beepSuccess =
				await this.matchmaking_notifier.notifyPlayersOfEnoughInterest(this.players.map(p => p.character));
		} else {
			sender.Tell("Whisper", `GAME: You cannot use this during a running game. Please register as a player ` +
				`if you have not done so and wait in the room until the next round starts.`
			);
		}
	}

	handleSubdueCommand(sender: API_Character) {
		// roll dice for willpower damage

		// if mistress willpower 0 or lower: players win
	}

	handleCorruptCommand(sender: API_Character) {
		// reduce mistress dominance by 1
	}

	handleMistressTurn(simulation: boolean = false) {
		// check if her willpower is below 50%, if so, heal dominance fully
		let starting_willpower: number = 0;
		if (simulation) {
			starting_willpower = this.simulatedWillpower;
		} else {
			starting_willpower = this.active_config.m_willpower;
		}
		if (this.mistress.boss_stage === 1 && (starting_willpower * 0.5) > this.mistress.willpower) {
			this.mistress.dominance = this.active_config.m_dominance;
			this.mistress.boss_stage = 2;
			if (!simulation) {
				// announce this event
			}
		}

		// check turn timer and game config to determine if she does an action this turn
		let doActionThisTurn: boolean = false;
		switch (this.active_config.players) {
			case 4:
				doActionThisTurn = true;
				break;
			case 3:
				doActionThisTurn = true;
				if (this.gameRound % 4 === 0) doActionThisTurn = false;
				break;
			case 2:
				if (this.gameRound % 2 === 0) doActionThisTurn = true;
				break;
			case 1:
				if (this.gameRound % 4 === 0) doActionThisTurn = true;
				break;
		}

		// determine target of an action
		let target: Player | null = null;
		for (const player of this.players) {
			if (player.loseCounter > 0) {
				if (target === null) {
					target = player;
				} else {
					if (player.loseCounter < target.loseCounter) target = player;
				}
			}
		}

		// if everyone is tied up: mistress wins
		if (target === null) {
			// mistress wins
			return false;
			// if each player is at the starting value, meaning it is the first action of the game, select a random player
		} else if (target.loseCounter === 7) {
			const randomIndex = Math.floor(Math.random() * this.active_config.players);
			target = this.players[randomIndex];
		}

		if (doActionThisTurn && target !== null) {
			this.doMistressAction(target, simulation);
		}

		// proceed to the next round / Note: maybe put this somewhere else
		this.gameRound++;
		return true;
	}

	doMistressAction(target: Player, simulation: boolean = false) {
		// determine the next type of stripping / restraint on the target player

		// execute it
		target.loseCounter = target.loseCounter - 1;
		logger.info(`losecounter: ${target.loseCounter}`);
	}

	handlePlayerTurns() {
		for (const player of this.players) {
			this.handlePlayerTurn(player);
		}
	}

	handlePlayerTurn(player: Player) {
		// depending on the status effects on the player due to item effects, print them their command options

	}

	handleSimulateGameCommand(msg: string, sender: API_Character) {
		// TODO: allow only admins to run this

		const match = (/^([0-9]+)\s([0-9]+)\s([0-9]+)\s([0-9]+)$/i).exec(msg);
		if (!match) {
			sender.Tell("Whisper", `GAME: Bad format, expected four integer: var1 -> numberOfPlayers / var2 -> timesCorruptCommandPerPlayerPhase1 ` +
				`/ var3 -> timesCorruptCommandPerPlayerPhase2 / var4 -> willpower.`
			);
			return;
		}

		// parse command: var1 -> numberOfPlayers / var2 -> timesCorruptCommandPerPlayerPhase1 / var3 -> timesCorruptCommandPerPlayerPhase2
		//                var4 -> willpower
		const numberOfPlayers = Number.parseInt(match[1], 10);
		const timesCorruptCommandPerPlayerPhase1 = Number.parseInt(match[2], 10);
		const timesCorruptCommandPerPlayerPhase2 = Number.parseInt(match[3], 10);
		const willpower = Number.parseInt(match[4], 10);

		this.simulatedWillpower = willpower;

		let config: configurationName;
		if (numberOfPlayers === 1) {
			config = "1player";
		} else if (numberOfPlayers === 2) {
			config = "2players";
		} else if (numberOfPlayers === 3) {
			config = "3players";
		} else if (numberOfPlayers === 4) {
			config = "4players";
		} else {
			logger.error("Illegal number of players.");
			return;
		}
		this.setActiveConfigFromTemplate(config);

		// call newSimulateOneGame() 100 times  (returns true or false for player win or loss)
		// count win/loss and report
		let player_wins: number = 0;
		for (let i = 0; i < 1; i++) {
			this.mistress.willpower = willpower;
			this.mistress.dominance = this.active_config.m_dominance;
			this.mistress.boss_stage = 1;
			this.players = [];
			this.gameRound = 1;
			if (this.simulateOneGame(numberOfPlayers, timesCorruptCommandPerPlayerPhase1, timesCorruptCommandPerPlayerPhase2)) {
				player_wins++;
			}
		}

		this.conn.SendMessage("Emote", `*GAME: The players won ${player_wins} out of 1 games.`);
	}

	/**
	 * Simulates one whole game based on input parameters and using actual game functions
	 * @param numberOfPlayers The number of players who are opposing the mistress this game
	 * @param timesCorruptCommandPerPlayerPhase1 How many times each player uses the corrupt command before switching to the subdue one
	 * @param timesCorruptCommandPerPlayerPhase2 How many times each player uses the corrupt command before switching to the subdue one after
	 *                                           mistress regenerated dominance
	 */
	simulateOneGame(numberOfPlayers: number, timesCorruptCommandPerPlayerPhase1: number, timesCorruptCommandPerPlayerPhase2: number) {
		// create all Players
		for (let i = 0; i < numberOfPlayers; i++) {
			const player = new Player(this.conn.Player);
			logger.info(`new losecounter: ${player.loseCounter}`);
			this.players.push(player);
		}

		while (this.mistress.willpower > 0) {
			let corruptTimes: number = 1;
			if (this.mistress.boss_stage === 1) {
				corruptTimes = timesCorruptCommandPerPlayerPhase1;
			} else {
				corruptTimes = timesCorruptCommandPerPlayerPhase2;
			}
			let loseCondition: number = 0;
			// depending on number of players and turn timer: do the player action(s)
			for (const player of this.players) {
				// player is too much tied up
				if (player.loseCounter === 0) {
					loseCondition++;
					logger.info(`lose condition after incrementing: ${loseCondition}`);
					continue;
				}
				// TEMP solution without item effects, except above
				if (this.gameRound <= corruptTimes && player.loseCounter > 2) {
					this.mistress.dominance--;
					logger.info(`Reduced dominance to: ${this.mistress.dominance}`);
				} else if (player.loseCounter > 1) {
					const roll = this.throwDice(this.active_config.dice_sides);
					if (roll > this.mistress.dominance) {
						this.mistress.willpower = this.mistress.willpower - (roll - this.mistress.dominance);
					}
					logger.info(`willpower: ${this.mistress.willpower} - - - - - - - roll was: ${roll}`);
				}
			}
			// if all players can no longer make a turn, return false
			if (loseCondition === numberOfPlayers) {
				return false;
			}

			// follow up by a simulated mistress turn and action
			const old_dominance = this.mistress.dominance;
			this.handleMistressTurn(true);
			// dominance regenerated, marking the start of phase 2
			if (this.mistress.dominance > old_dominance) {
				logger.info(`phase: ${this.mistress.boss_stage}`);
				this.gameRound = 1;
			}
		}
		return true;
	}

	/*
	handleSimulateGameCommand(msg: string, sender: API_Character) {
		const match = (/^([0-9]+)$/i).exec(msg);
		if (!match) {
			sender.Tell("Whisper", `GAME: Bad format, expected an integer.`
			);
			return;
		}
		const turns_of_dominance_action = Number.parseInt(match[1], 10);
		const p50 = 0.5 * 100;
		const p70 = 0.7 * 100;
		const p90 = 0.9 * 100;

		const result: number[] = [];
		for (let i = 0; i < 100; i++) {
			result.push(this.simulateOneGame(msg, turns_of_dominance_action));
		}
		result.sort((a,b) => a-b);

		this.conn.SendMessage("Emote", `*GAME: ${result}`);
		this.conn.SendMessage("Emote", `*GAME: 50% percentile was ${result[p50-1]}, 70% was ${result[p70-1]} and 90% was ${result[p90-1]} points of willpower damage in 100 games.`);
	}

	simulateOneGame(msg: string, turns_of_dominance_action: number) {
		const game_rounds: number = 28;

		let damage: number = 0;
		for (let i = 0; i < game_rounds - turns_of_dominance_action; i++) {
			const roll = this.throwDice();
			if (roll > (this.mistress.dominance - turns_of_dominance_action)) {
				damage = damage + (roll - (this.mistress.dominance - turns_of_dominance_action));
			}
		}
		return damage;
	} */

	// player turn
	// p-action A
	// p-action B


	// mistress turn
	// mistress taunt
	// mistress action

	// throw dice
	throwDice(sides: number) {
		return Math.floor(Math.random() * sides) + 1;
	}

	private Tick() {
		const now = Date.now();

		if (this.beepSuccess) {
			this.blockMatchmakingTimer = now + 3 * 60 * 1000;
			this.beepSuccess = false;
			this.blockMatchmakingJoin = true;
		}
		if (now >= this.blockMatchmakingTimer) {
			this.blockMatchmakingJoin = false;
		}

		if (this.gameState === "game_not_started") return;

		/**
		/ if all roles that are in the game and untied have used their night abilities, proceed to tying the kidnapper target up,
		/ unless there is still a mistress under the remaining club members, preventing it
		/ However, if it is the first night and firstNightKidnapping is switch off, then ignore the kidnapping target condition
		/ role in game free and done       this.role !== null &&  this.club_members.has(this.role) && this.roles_target !== null   go-into-if
		/ role in game free and not done   this.role !== null &&  this.club_members.has(this.role) && this.roles_target === null   dont-go-in
		/ role in game not free            this.role !== null && !this.club_members.has(this.role) && this.roles_target === null   go-into-if
		/ role not in game		   		   this.role === null && !this.club_members.has(this.role) && this.roles_target === null   go-into-if
		/
			 SOLUTION:         	   this.role === null || (this.role !== null && !this.club_members.has(this.role)) || this.stalker_target !== null
		*/

		// if ((this.gameState === "waiting_on_night_activities" || this.gameState === "night_1")
		// && (this.mistress === null || (this.mistress !== null && !this.club_members.has(this.mistress)) || this.mistress_target !== null )
		// && (this.maid === null || (this.maid !== null && !this.club_members.has(this.maid)) || this.maid_target !== null )
		// && (this.stalker === null || (this.stalker !== null && !this.club_members.has(this.stalker)) || this.stalker_target !== null )) {
		// 	if (this.kidnappers_target !== null) {
		// 		if ((this.mistress !== null && !this.club_members.has(this.mistress))
		// 		|| this.mistress_target !== this.kidnappers_target) {
		// 			this.tieUpCharacterAndRemove("kidnapper", this.kidnappers_target);
		// 			this.conn.SendMessage("Emote", `*GAME: The sun starts rising and the club members slowly realize that ` +
		// 				`${this.kidnappers_target.Name} is missing. Another kidnapping! Who is it?`
		// 			);
		// 		} else if (this.active_config.announceMistressProtectionSucess) {
		// 			this.conn.SendMessage("Emote", `*GAME: The sun starts rising - it's a lovely new day! The dashing mistress ` +
		// 				`prevented a kidnapping last night, as witnesses saw a rope carrying shadow approaching her room but then running away again.`
		// 			);
		// 		} else {
		// 			this.conn.SendMessage("Emote", `*GAME: The sun starts rising - it's a lovely new day! There was no kidnapping last night!`);
		// 		}
		// 		this.setGameState("waiting_on_day_activities");
		// 		this.giveDayInstructions();
		// 	} else if (this.gameState === "night_1" && !this.active_config.firstNightKidnapping) {
		// 		this.conn.SendMessage("Emote", `*GAME: The sun starts rising - it's a lovely new day! The kidnappings seemingly did not start yet.`);
		// 		this.setGameState("waiting_on_day_activities");
		// 		this.giveDayInstructions();
		// 	}
		// }


		if (now >= this.turnTimer) {
			if (this.gameState === "player_phase") {
				this.setGameState("mistress_phase");
				// TODO: do mistress turn
			} else if (this.gameState === "game_was_won") {
				this.conn.SendMessage("Emote", `*GAME: The next game can now by started by any registered player with '!start'. ` +
					`Every tied up player will be untied then.`
				);
				this.setGameState("game_not_started");
			}
		}
	}

	private setGameState(state: GameState, updateRoom: boolean = true) {

		this.gameState = state;
		if (state === "game_not_started") {
			if (updateRoom) {
				this.changeRoomBackgroundTo("MainHall");
			}
			// this.chosen_players.clear();
		} else if (state === "player_phase") {
			// default: 30sec
			this.turnTimer = Date.now() + this.active_config.turnDuration;
		} else if (state === "game_was_won") {
			// default: 1m before the next game can be started
			this.turnTimer = Date.now() + this.active_config.victoryDuration;
		} else {
			logger.error("Bad state", state);
		}
	}

	playerCheck(character: API_Character) {
		let hadWarnings = false;
		const itemsCannotRemove = character.Appearance.Appearance.filter(A => listOfUsedItemGroups.includes(A.Group) && !A.AllowRemove());
		if (itemsCannotRemove.length > 0) {
			character.Tell("Chat", `Warning: The game will conflict with following restraints you have on you:\n` +
				itemsCannotRemove.map(A => A.Name).join(", ") +
				`\nThe game cannot remove these because of locks or other limiting factors`
			);
			logger.info(`Player check for ${character}: Unremovable items: ` + itemsCannotRemove.map(A => A.Name).join(", "));
			hadWarnings = true;
		}
		const itemsToRemove = character.Appearance.Appearance.filter(A => listOfUsedItemGroups.includes(A.Group) && A.AllowRemove());
		if (itemsToRemove.length !== 0) {
			character.Tell("Chat", `Warning: Since you are currently tied up, please note that the game will remove the following ` +
				`restraints you have on you at the start of the next game:\n` +
				itemsToRemove.map(A => A.Name).join(", ") +
				`\nIf you are not fine with that, you may want to leave the room again instead.`
			);
			logger.info(`Player check for ${character}: Items to remove: ` + itemsToRemove.map(A => A.Name).join(", "));
			hadWarnings = true;
		}
		const itemsCannotUse = listOfUsedItemsInThisScene.filter(item => !character.IsItemPermissionAccessible(AssetGet(item[0], item[1]), item[2]));
		if (itemsCannotUse.length > 0) {
			character.Tell("Chat", `Warning: The game uses following items, but you have them blocked or limited:\n` +
				itemsCannotUse.map(A => A.join(":")).join(", ")
			);
			logger.info(`Player check for ${character}: Blocked items: ` + itemsCannotUse.map(A => A.join(":")).join(", "));
			hadWarnings = true;
		}
		if (hadWarnings) {
			character.Tell("Whisper", `These warnings won't prevent you from playing, but may cause your experience to be degraded.\n` +
				`We recommend fixing these and re-running the check by whispering 'check' to the bot`
			);
		} else {
			logger.info(`Player check for ${character}: No warning`);
		}
		return !hadWarnings;
	}


	/**
	 * Frees the player from the slots given in the function
	 * @param character the current player
	 * @param itemSlots an array of all item slots where the player should be freed
	 */
	freeCharacterInItemSlots(character: API_Character, itemSlots: string[]) {
		for (const i of itemSlots) {
			character.Appearance.RemoveItem(i);
		}
	}

	/**
	 * Updates the current room the bot is in with a given background
	 * @param name the name of the background
	 */
	changeRoomBackgroundTo(name: string): void {
		void this.conn.ChatRoomUpdate({
			Background: name
		});
	}

	destroy() {
		clearInterval(this.tickTimer);
		super.destroy();
	}

}
