import { AssetGet, logger } from "bondage-club-bot-api";
import promClient from "prom-client";

import { shuffleArray, wait } from "../utils";
import { AdministrationLogic } from "./administrationLogic";
import { MatchmakingNotifier } from "../gameroomMatchmaking";

type GameState =
	| "game_not_started"
	| "waiting_on_next_turn"
	| "waiting_on_statement"
	| "waiting_on_whispers"
	| "waiting_on_tease_selection"
	| "waiting_on_reveal";

interface Whisper {
	character: API_Character;
	whisper: string;
}

/** The matchmaking queue count that triggers a beep message to everyone on it */
const BEEP_AT_THIS_COUNT = 4;

export class IwouldnotmindGameRoom extends AdministrationLogic {
	/** The registered players */
	players: API_Character[] = [];
	/** The players that need to whisper */
	whisperer: Set<API_Character> = new Set();
	/** the player currently at turn */
	active_player: API_Character | null = null;
	whispers: Whisper[] = [];
	gameState: GameState = "game_not_started";
	turnTimer: number = 0;

	matchmaking_notifier: MatchmakingNotifier;
	/** Block the beepme command when this is true */
	blockMatchmakingJoin: boolean = false;
	/** To be set to true when a match was found */
	beepSuccess: boolean = false;
	/** Timer for blocking the beepme command shortly after a successful match*/
	blockMatchmakingTimer: number = 0;

	private tickTimer: NodeJS.Timeout;

	private charTimer: Map<API_Character, ReturnType<typeof setTimeout>> = new Map();

	readonly conn: API_Connector;

	// Metrics
	private metric_gameStarted = new promClient.Counter({
		name: "hub_iwouldnotmind_game_started",
		help: "hub_iwouldnotmind_game_started"
	});

	constructor(conn: API_Connector) {
		super({inactivityKickEnabledOnlyBelowFreeSlotsCount: 5});
		this.conn = conn;

		this.registerCommand("status", (connection, args, sender) => this.handleStatusCommand(sender), `To get information about the running game`);
		this.registerCommand("joingame", (connection, args, sender) => this.handleJoingameCommand(sender), `To register as a new player`);
		this.registerCommand("next", (connection, args, sender) => this.handleNextCommand(sender), `To start a new round after registering`);
		this.registerCommand("pick", (connection, args, sender) => this.revealSelection(args, sender), null);
		this.registerCommand("beepme", (connection, args, sender) => this.handleBeepmeCommand(sender), `To get beeped when enough players are online`);

		this.metric_gameStarted.reset();

		this.matchmaking_notifier = new MatchmakingNotifier(conn, BEEP_AT_THIS_COUNT);

		this.tickTimer = setInterval(this.Tick.bind(this), 1000);
		this.setGameState("game_not_started", false);
	}

	/**
	 * The opening note when a player enters the room
	 * @param character the player in question
	 */
	playerGreeting(character: API_Character) {
		character.Tell("Emote", "*Welcome to this game room where we play");
		character.Tell("Chat", "'I wouldn't mind'");
		// TODO: Another great oppurtunity to advertise the bot and add some link to more info in the bot's profile
		character.Tell("Emote", `*a kinky and fun multiplayer game in the spirit of popular party games like truth and dare. The game ` +
			`is best played with four to five players, but can be started with three. ` +
			`Please find the manual and the WHISPER commands to participate in the online description / profile ` +
			`of the game's host '${this.conn.Player}'.`
		);
		character.Tell("Chat", "NEWS: If you want to be notified when a game can be started, there is a new command for sending you a BEEP (see bot profile).");
	}

	// Backup of the online description of the bot
	static readonly description = `
I WOULDN'T MIND
===================================================================
a game by Lily, room concept by Claudia & Clare, using Jomshir's BotAPI

In memory of Lily, one of the oldest mistresses of the club, who loves to play games and wanted to bring joy to awesome people with her creative game ideas. 'I wouldn't mind' is her masterpiece.
It is a kinky and fun multiplayer game in the spirit of popular party games like truth and dare. The game is best played with four to five players, but can be started with three.

Game flow
---------------------------
'I wouldn't mind' is a game played in turns. In each, the player at turn announces a statement starting with 'I wouldn't mind...'. For example: 'I wouldn't mind being tied up a little bit.' or 'I wouldn't mind having my shoes kissed~'. Then every other player in the room prepares a tease of what they would do to that person if their tease is chosen, for instance 'Oh I would tie you so tightly you wouldn't be able to move an inch!' or 'I would kiss your shoes so much you will tire of it, Miss!'

Every "promise" aka tease is WHISPERED to the bot. After all players except the one who's turn it is have whispered their tease to the bot, she will state all of them openly in the chat but without revealing who said which tease.

Now the player who said her "I wouldn't mind" statement chooses the promise/tease she likes the most. Then the author of the winner sentence is revealed and... CHOOSES if she wants to do what she promised or not :3
So she can really tie up or kiss shoes or do whatever she said... or she can just say something like 'Haha! Joke's on you, I won't do it~' and that is fair too.

After the tease was fulfilled or denied, the next turn can be started by anybody saying '!next' aloud in the chat. All effects of a tease per default should last for one cycle/round, meaning until it is the teased player's turn again, unless the tease states differently. If a previous tease prevents you to do or recieve a new tease, the previous one should be put out of effect early.

So to summarize, the whole point of the game is to play with the players' expectations and desires, making it a lot of fun for all kinds of people and their various kinks.

Game end
---------------------------
There is no game end or victory condition, as the game continues endlessly as long as there are enough players to start a new round. Players can join and leave as they like.

Please don't afk in the room or disturb the game!
Enjoy, be fair and respect each other and the rules!


The game commands
===================================================================
Note: All these commands need to be whispered to the bot. Please be mindful that your immersion settings or owner rules may prevent you from being able to whisper.

► !help                  To show a list of these commands into the chat, whisper '!?' or '!help'

► !beepme             To get beeped when enough players for a game are available
► !feedback          To send the message after the command as feedback to the authors
► !joingame          To register as a new player, whisper '!joingame'
► !kick                  To start a vote to kick someone from the room: !kick [name] [reason]
► !listvotes           To list all currently running types of votes, e.g. kick votes
► !next                 To start a new round, whisper '!next', after registering. Needs 3+ players.
► !status              To get information about the running game, whisper '!status'

Note: There may be some further context-specific commands used during short phases of the game that are not listet here or in the help. Those are announced in-game when relevant.


Weekly game room rotation
===================================
We noticed that running all three of the game rooms in parallel does not work well, due to interested players not waiting if the room is empty but also not sufficiently using the !beepme command for matchmaking purposes. For now, we therefore put the game rooms on a weekly rotation to focus player interest:

Monday         I wouldn't mind
Tuesday        Roleplay Challenge
Wednesday   Kidnappers
Thursday       Roleplay Challenge
Friday            I wouldn't mind
Saturday        Kidnappers + I wouldn't mind
Sunday          Kidnappers + Roleplay Challenge


Contact us
===================================
You can whisper any feedback (including bug reports) for the authors of the room to the bot, by starting your message with '!feedback' (e.g. !feedback I want to tell you that...).
In urgent cases, you can also contact Jomshir, the creator of the bot, on BondageClub discord: Jomshir98#0022

This bot was created using Jomshir's BotAPI.
If you would like to make a bot room similar to this one, you can find all necessary info on the Bondage Club Scripting Community Discord: https://discord.gg/SHJMjEh9VH

☻Have fun~☺
`.trim();

	/**
	 * When character enters the room
	 * @param connection Originating connection
	 * @param character The character that entered the room
	 */
	protected async onCharacterEntered(connection: API_Connector, character: API_Character): Promise<void> {
		if (character.IsBot()) return;
		const oldIndex = this.players.findIndex(p => p.MemberNumber === character.MemberNumber);
		if (oldIndex >= 0) {
			// old player returning

			this.charTimer.forEach((value, key) => key.MemberNumber === character.MemberNumber && clearTimeout(value));

			if (this.whisperer.has(this.players[oldIndex])) {
				this.whisperer.delete(this.players[oldIndex]);
				this.whisperer.add(character);
			}
			if (this.active_player === this.players[oldIndex]) {
				this.active_player = character;
			}
			this.players.splice(oldIndex, 1, character);
			// Move player back to original position
			if (this.players.includes(character)) {
				await this.reorderPlayers();
			}
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
		if (this.players.includes(character) && intentional) {
			this.unregisterPlayer(character, " due to leaving the room.");
		} else if (this.players.includes(character) && !intentional) {
			this.charTimer.set(character, setTimeout(() => { void this.unregisterPlayer(character, " due to disconnecting."); }, 60_000));
		}
	}

	private unregisterPlayer(character: API_Character, message: string) {
		if (this.players.includes(character)) {
			this.conn.SendMessage("Emote", `*GAME: ${character} was unregistered as an active player` + message);
			const index = this.players.indexOf(character, 0);
			if (index > -1) {
				// player at turn left, therefore do a soft reset
				if (this.active_player === character && this.players.length > 1) {
					this.active_player = this.players[index === 0 ? this.players.length - 1 : index - 1];
					if (!this.conn.chatRoom.characters.includes(character)) {
						this.waitForNextRoundAsPlayerLeft();
					}
				}
				this.players.splice(index, 1);
				if (this.players.length === 0) {
					this.setGameState("game_not_started");
				}
			}
		}
		this.whisperer.delete(character);
		// the last person we were waiting on to whisper to the bot, left the room
		if (this.whisperer.size === 0 && this.gameState === "waiting_on_whispers") {
			this.revealWhispers();
		}
	}

	private waitForNextRoundAsPlayerLeft() {
		this.conn.SendMessage("Emote", `*GAME: As the player at turn has left the room, please start the next round by whispering '!next'.`);
		this.setGameState("waiting_on_next_turn");
	}

	/**
	 * When connection receives message inside chatroom
	 * @param connection Originating connection
	 * @param message Received message
	 * @param sender The character that sent the message
	 */
	protected async onMessage(connection: API_Connector, message: BC_Server_ChatRoomMessage, sender: API_Character): Promise<void> {
		if (!sender.IsBot() && message.Type !== "Hidden") {
			super.onMessage(connection, message, sender);
		}

		const msg = message.Content.toLocaleLowerCase();

		if (message.Type === "Chat") {
			if (this.active_player === sender && this.gameState === "waiting_on_statement") {
				if (msg.includes("i wouldn't mind") || msg.includes("i would not mind")) {
					this.whisperer.clear();
					for (const c of this.players) {
						if (c !== sender) {
							this.whisperer.add(c);
						}
					}
					this.conn.SendMessage("Emote", `*GAME: ${sender.Name} has completed her turn, the game will proceed when the following players have ` +
						`whispered their tease answer to the bot '${this.conn.Player.Name}': ` + Array.from(this.whisperer.values()).map(C => C.Name).join(", ")
					);
					this.setGameState("waiting_on_whispers");
				} else if ((msg.startsWith("i") || msg.startsWith("'i") || msg.startsWith(`"i`)) && msg.includes("mind")) {
					sender.Tell("Whisper", `Bad format, expected your statement to start with: I would not mind`);
				}
			} else if (msg.startsWith("!pick") && this.active_player === sender && this.gameState === "waiting_on_tease_selection") {
				const match = (/^!pick ([0-9]+)$/i).exec(msg);
				if (!match) {
					sender.Tell("Whisper", `Bad format, expected '!pick [number]', for example !pick 2`);
					return;
				}
				await this.revealSelection(match[1], sender);
			}
		}

		if (message.Type === "Whisper") {
			if (this.whisperer.has(sender) && this.gameState === "waiting_on_whispers") {
				this.whispers.push({ character: sender, whisper: message.Content });
				this.whisperer.delete(sender);
				if (this.whisperer.size === 2) {
					// we reduce timer to 2 mins if it is larger than 2 mins and set new timer in that case
					this.turnTimer = Math.min(this.turnTimer, Date.now() + 120_000);
					this.Tick();
				} else if (this.whisperer.size === 1) {
					// we reduce timer to 1 min if it is larger than 1 min and set new timer in that case
					this.turnTimer = Math.min(this.turnTimer, Date.now() + 60_000);
					this.Tick();
				} else if (this.whisperer.size === 0) {
					this.revealWhispers();
				}
			} else if (
				(msg.startsWith("i") || msg.startsWith("'i") || msg.startsWith(`"i`)) && msg.includes("mind") &&
				this.active_player === sender &&
				this.gameState === "waiting_on_statement"
			) {
				sender.Tell("Whisper", `Your 'I would not mind' statement needs to be said out loud in the chat.`);
			}
		}

	}

	async revealSelection(msg: string, sender: API_Character) {
		if (this.active_player !== sender || this.gameState !== "waiting_on_tease_selection") {
			return;
		}
		const i = Number.parseInt(msg, 10) - 1;
		if (Number.isInteger(i) && i >= 0 && i < this.whispers.length) {
			// adding special state so the player cannot time out between pick command and reveal
			this.setGameState("waiting_on_reveal");
			const picked = this.whispers[i];
			this.conn.SendMessage("Emote", `*GAME: ${this.active_player.Name} chose:\n` +
				`${picked.whisper}`
			);
			await wait(3000);
			this.conn.SendMessage("Emote", `*This tease is by...                                                         *`);
			const times = Math.floor(Math.random() * (5 - 2)) + 2;
			for (let j = 0; j < times; j++) {
				await wait(1000);
				this.conn.SendMessage("Emote", `*...                                                                                  *`);
			}
			await wait(1000);
			this.conn.SendMessage("Emote", `*... ${picked.character} !!!`);
			this.setGameState("waiting_on_next_turn");
		} else {
			sender.Tell("Whisper", `Invalid number, expected '!pick [number]' from the numbers in front of one of the teases ` +
				`you got, for example !pick 2`
			);
		}
	}

	handleStatusCommand(sender: API_Character) {
		sender.Tell("Whisper", `This is the current status of the game:\n` +
			`${(this.gameState === "game_not_started" || this.gameState === "waiting_on_next_turn") ?
			`There are ${this.matchmaking_notifier.waitingPlayers > 0 ? `players` : `no players`} in the 'matchmaking ` +
			`queue'. You may want to consider joining the queue with the beepme command to speed up the next match.\n` : ``}` +
			`The game has the following registered players:\n` +
			this.players.map(A => A.toString()).join(", ") + `\nThe player at turn is: ${this.active_player !== null ? this.active_player : "none"}\n` +
			`The player next turn will be: ${this.players.length > 1 && this.active_player !== null ?
				this.players[(this.players.indexOf(this.active_player) + 1) % this.players.length] : "none"}` +
			`${this.gameState === "waiting_on_whispers" ? "\nThe following players still need to whisper a tease for " +
			`${this.active_player !== null ? this.active_player : "none"} to ` +
			`the bot:\n${Array.from(this.whisperer.values()).map(C => C.toString()).join(", ")}` : ""}`
		);
	}

	async handleJoingameCommand(sender: API_Character) {
		if (this.players.includes(sender)) {
			return;
		}
		this.players.push(sender);
		this.conn.SendMessage("Emote", `*GAME: ${sender} was registered as an active player.`);

		this.beepSuccess = await this.matchmaking_notifier.notifyPlayersOfEnoughInterest(this.players);
		void this.conn.ChatRoomUpdate({
			Description: `[BOT] scripted multiplayer gameroom | manual in bot profile | ${this.matchmaking_notifier.waitingPlayers} queued`
		});
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
		// Move players to their positions
		await this.reorderPlayers();
		await this.doTheWiggleDance();
		// saw some bugs, therefore make sure it was reset
		await wait(7000);
		this.conn.Player.SetActivePose([]);
	}

	handleNextCommand(sender: API_Character) {
		if (!this.players.includes(sender)) {
			sender.Tell("Whisper", "GAME: Please register first by writing '!joingame' into the chat.");
		} else if (this.players.includes(sender) &&
			(this.gameState === "game_not_started" || this.gameState === "waiting_on_next_turn")) {
			if (this.players.length < 3) {
				this.conn.SendMessage("Emote", `*GAME: The game needs a minimum of three registered players to start the next round.`);
				return;
			}
			this.setGameState("waiting_on_statement");
			const nextPlayer = this.determineNextPlayer();
			this.conn.SendMessage("Emote", `*GAME: The next round starts. It is ${nextPlayer}'s turn to openly announce an 'I would not mind' statement.`);
		} else {
			sender.Tell("Whisper", "GAME: A round is currently already in progress. You will be part of the next round.");
		}
	}

	async handleBeepmeCommand(sender: API_Character) {
		if (this.blockMatchmakingJoin) {
			sender.Tell("Whisper", `GAME: The beepme command is temporarily deactivated, since the previous 'matchmaking' ` +
				`was successful just now. Please wait until everyone who was beeped will join this room and try the command ` +
				`again in a few minutes, in case not enough players for starting a game will join.`
			);
		} else if (this.gameState === "game_not_started" || this.gameState === "waiting_on_next_turn") {
			await this.matchmaking_notifier.addPlayerToTheMatchmakingQueue(sender);
			void this.conn.ChatRoomUpdate({
				Description: `[BOT] scripted multiplayer gameroom | manual in bot profile | ${this.matchmaking_notifier.waitingPlayers} queued`
			});
			this.beepSuccess =
				await this.matchmaking_notifier.notifyPlayersOfEnoughInterest(this.players);
		} else {
			sender.Tell("Whisper", `GAME: You cannot use this during a running game. Please register as a player ` +
				`if you have not done so and wait in the room until the next round starts.`
			);
		}
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

		if (this.gameState === "game_not_started" || this.gameState === "waiting_on_next_turn" || this.gameState === "waiting_on_reveal") return;

		if (now >= this.turnTimer) {
			if (this.gameState === "waiting_on_statement") {
				this.setGameState("waiting_on_next_turn");
				if (this.active_player) {
					this.unregisterPlayer(this.active_player, " due to taking too long for their turn. Please start the next round by whispering '!next'");
				} else {
					logger.error(`Was waiting_on_statement without active player!`);
				}
			} else if (this.gameState === "waiting_on_tease_selection") {
				this.setGameState("waiting_on_next_turn");
				if (this.active_player) {
					this.unregisterPlayer(this.active_player, " due to taking too long for selecting a tease. Please start the next round by whispering '!next'");
				} else {
					logger.error(`Was waiting_on_tease_selection without active player!`);
				}
			} else if (this.gameState === "waiting_on_whispers") {
				if (this.whispers.length > 0) {
					if (this.whisperer.size === 0) {
						this.revealWhispers();
					} else {
						for (const player of this.whisperer) {
							this.unregisterPlayer(player, " due to taking too long to whisper a tease.");
						}
					}
				} else {
					this.conn.SendMessage("Emote", "*GAME: No whisper has been received within time limit. Please start the next round by whispering '!next'");
					this.setGameState("waiting_on_next_turn");
				}
			}
		}

		this.updateSign();
	}

	private updateSign() {
		const now = Date.now();
		const tickAlternateText = (Math.floor(now / 1000) % 10) < 5;

		const sign = this.conn.Player.Appearance.AddItem(AssetGet("ItemMisc", "WoodenSign"));
		if (sign) {
			// sign.
			let text = "";
			let textColor = "#FFFFFF";
			const green = "#7AFF4F";
			const red = "#F42C31";
			const timeLeft = Math.ceil(Math.max(0, this.turnTimer - now)/1000);
			const timeLeftString = `${Math.floor(timeLeft / 60)}m ${timeLeft % 60}s`;
			if (this.gameState === "game_not_started") {
				text = "I would\nnot mind";
			} else if (this.gameState === "waiting_on_statement") {
				text = tickAlternateText ? `Waiting for\nstatement` : `${timeLeftString}\nleft`;
				textColor = timeLeft < 45 ? red : green;
			} else if (this.gameState === "waiting_on_next_turn") {
				text = "Waiting for\nnext turn";
			} else if (this.gameState === "waiting_on_tease_selection") {
				text = tickAlternateText ? `Waiting for\nselection` : `${timeLeftString}\nleft`;
				textColor = timeLeft < 30 ? red : green;
			} else if (this.gameState === "waiting_on_reveal") {
				text = "*drumroll*";
			} else if (this.gameState === "waiting_on_whispers") {
				text = tickAlternateText ? `Waiting for\n${this.whisperer.size} whisper` + (this.whisperer.size > 1 ? "s" : "") : `${timeLeftString}\nleft`;
				textColor = timeLeft < 60 ? red : green;
			} else {
				text = "ERROR";
			}
			sign.Extended?.SetText(text);
			sign.SetColor(["#000000", "#040404", textColor]);
		}
	}

	private setGameState(state: GameState, updateRoom: boolean = true) {
		logger.debug(`[I would not mind] Change gamestate: ${this.gameState}->${state}`);
		this.gameState = state;
		if (state === "game_not_started") {
			if (updateRoom) {
				void this.conn.ChatRoomUpdate({
					Description: `[BOT] scripted multiplayer gameroom | manual in bot profile | READY`
				});
			}
			this.active_player = null;
			this.whispers = [];
			this.whisperer.clear();
		} else if (state === "waiting_on_statement") {
			this.metric_gameStarted.inc();
			// 2m to give statement
			this.turnTimer = Date.now() + 120_000;
		} else if (state === "waiting_on_whispers") {
			// 4m to give whispers
			this.turnTimer = Date.now() + 240_000;
		} else if (state === "waiting_on_next_turn") {
			this.whispers = [];
			this.whisperer.clear();
		} else if (state === "waiting_on_tease_selection") {
			// 2.5m to select tease
			this.turnTimer = Date.now() + 150_000;
		} else if (state === "waiting_on_reveal") {
			// nothing
		} else {
			logger.error("Bad state", state);
		}

		this.updateSign();
	}

	private revealWhispers() {
		if (this.whispers.length === 0) {
			this.conn.SendMessage("Emote", `*GAME: As no whisper has been received, please start the next round by whispering '!next'.`);
			this.setGameState("waiting_on_next_turn");
			return;
		}
		if (this.active_player !== null) {
			shuffleArray(this.whispers);
			this.conn.SendMessage("Emote", `*GAME: Dear ${this.active_player.Name}, all whispers have been received. Please choose one of the following teases ` +
				`by typing '!pick' and the number in front of your tease (for example !pick 2) into the chat:` +
				`\n ` + this.whispers.map((C, i) => `(${i + 1}) - ${C.whisper}`).join("\n ")
			);
		}
		this.setGameState("waiting_on_tease_selection");
	}

	async doTheWiggleDance() {
		for (let i = 0; i < 4; i++) {
			this.conn.Player.SetActivePose(["Yoked"]);
			await wait(350);
			this.conn.Player.SetHeightOverride(50);
			this.conn.Player.SetActivePose(["OverTheHead", "Kneel"]);
			await wait(600);
			this.conn.Player.SetHeightOverride(null);
		}
		this.conn.Player.SetActivePose(["Yoked"]);
		await wait(400);
		this.conn.Player.SetActivePose(["BaseUpper"]);
	}

	determineNextPlayer() {
		if (this.active_player === null) {
			this.active_player = this.players[0];
		} else {
			this.active_player = this.players[(this.players.indexOf(this.active_player) + 1) % this.players.length];
		}
		return this.active_player;
	}

	async reorderPlayers() {
		let pos = 0;
		for (const player of this.players) {
			try {
				await player.MoveToPos(pos);
				pos++;
			} catch (error) {
				logger.warning(`Failed to move player ${player}:`, error);
			}
		}
		await this.conn.Player.MoveToPos(pos);
	}

	destroy() {
		clearInterval(this.tickTimer);
		super.destroy();
	}

}
