import { logger, LogicBase } from "bondage-club-bot-api";

import { SUPERUSERS } from "../config";

import _ from "lodash";
import fs from "fs";

export interface IAdminLogicSettings {
	log: boolean;
	logConnectionMemberNumber: boolean;
	logConnectionName: boolean;
	kickVotingEnabled: boolean;
	votingEnabled: boolean;
	catchUnknownCommands: boolean;
	inactivityKickTimer: number | null;
	inactivityWarningTimer: number | null;
	inactivityKickEnabledOnlyBelowFreeSlotsCount: number | null;
}

interface IAdminCommandInfo {
	description: string | null;
}

type AdminCommandHandlerRaw = (connection: API_Connector, args: string, sender: API_Character) => void | Promise<any>;
type AdminCommandHandlerParsed = (connection: API_Connector, argv: string[], sender: API_Character) => void | Promise<any>;
type AdminCommandHandlerSu = (connection: API_Connector, argv: string[], sender: number, respond: (response: string) => void) => void | Promise<any>;

interface IAdminCommandRaw extends IAdminCommandInfo {
	parse: false;
	callback: AdminCommandHandlerRaw;
}

interface IAdminCommandParsed extends IAdminCommandInfo {
	parse: true;
	callback: AdminCommandHandlerParsed;
}

export interface IAdminVoteResults {
	name: string;
	yes: number;
	no: number;
	didNotVote: number;
}

interface IAdminVoteData {
	name: string;
	description: string;
	votes: Map<API_Character, boolean | null>;
	endTime: number;
	progress?: (data: IAdminVoteResults) => boolean;
	resolve: (results: IAdminVoteResults) => void;
}

// Global config
const KICKVOTE_DURATION: number = 300;
const KICKVOTE_PROTECTION_DURATION: number = 360;
const KICKVOTE_BAN_AVAILABILITY: number = 3600;
// TODO: maybe refactor those three above also in the more clear format e.g. 60 * 60 * 1000
// to be consistent with the style few lines below and not add the *1000 only in the function

export class AdministrationLogic extends LogicBase {

	private readonly a_settings: IAdminLogicSettings = {
		log: true,
		logConnectionMemberNumber: false,
		logConnectionName: false,
		kickVotingEnabled: true,
		votingEnabled: true,
		catchUnknownCommands: true,
		inactivityKickTimer: 15 * 60 * 1000,
		inactivityWarningTimer: 10 * 60 * 1000,
		inactivityKickEnabledOnlyBelowFreeSlotsCount: null
	};
	private a_destroyed: boolean = false;
	private readonly a_tickTimer: NodeJS.Timeout;

	private a_commands: Map<string, IAdminCommandRaw | IAdminCommandParsed> = new Map();
	private a_SUCommands: Map<string, AdminCommandHandlerSu> = new Map();
	private a_pendingVotes: Map<string, IAdminVoteData> = new Map();

	private a_kickProtection: WeakMap<API_Character, number> = new WeakMap();
	private a_banAvailability: Map<number, number> = new Map();
	private a_notBanComfirmation: WeakMap<API_Character, number> = new WeakMap();

	private a_lastActivity: Map<API_Character, number> = new Map();
	private a_inactivityDidWarn: WeakSet<API_Character> = new WeakSet();

	constructor(settings: Partial<IAdminLogicSettings>) {
		super();
		Object.assign(this.a_settings, settings);
		logger.onfatal(this.destroy.bind(this));
		this.registerCommand("help", (connection, args, sender) => this.on_Help(sender), "Shows this list of commands");
		this.registerCommand("?", (connection, args, sender) => this.on_Help(sender), null);

		if (this.a_settings.kickVotingEnabled) {
			this.a_settings.votingEnabled = true;
			this.registerCommand("kick", this.a_command_kick.bind(this, false), "Starts a vote to kick player");
			this.registerCommand("ban", this.a_command_kick.bind(this, true), null);
		}

		if (this.a_settings.votingEnabled) {
			this.registerCommand("yes", this.a_CharacterVote.bind(this, true), null);
			this.registerCommand("no", this.a_CharacterVote.bind(this, false), null);
			this.registerCommand("listvotes", this.a_command_listVotes.bind(this), "List currently ongoing votes");
		}

		this.registerCommand("feedback", this.a_command_feedback.bind(this), "Send a message as feedback to the authors");

		const suRunner: AdminCommandHandlerParsed = (connection, argv, sender) => this.a_command_su(connection, argv, sender.MemberNumber, response => sender.Tell("Whisper", response));
		this.registerCommandParsed("su", suRunner, null);
		this.registerCommandParsed("sudo", suRunner, null);
		this.registerCommandParsed("admin", suRunner, null);

		//#region Admin commands
		this.registerSUCommand("help", (connection, argv, sender, respond) => {
			respond(`Registered SU commands:\n${Array.from(this.a_SUCommands.keys()).join("\n")}`);
		});

		this.registerSUCommand("say", (connection, argv, sender, respond) => {
			const msg = argv.join(" ").trim();
			if (msg) {
				logger.info(`${this.a_LogHeader(connection)} Admin chat from ${sender}: ${msg}`);
				if (msg.startsWith("*") && msg.length > 1) {
					connection.SendMessage("Emote", msg.substr(1).trim());
				} else {
					connection.SendMessage("Chat", msg);
				}
			} else {
				respond("Message expected.");
			}
		});

		this.registerSUCommand("kick", (connection, argv, sender, respond) => {
			if (argv.length !== 1) {
				return respond(`Target expected.`);
			}
			const target = this.identifyPlayerInRoom(connection.chatRoom, argv[0]);
			if (typeof target === "string") {
				respond(target);
				return;
			} else {
				respond("Ok");
				connection.SendMessage("Emote", `*${target} has been kicked by administrator.`);
				return target.Kick();
			}
		});

		this.registerSUCommand("ban", (connection, argv, sender, respond) => {
			if (argv.length !== 1) {
				return respond(`Target expected.`);
			}
			const target = this.identifyPlayerInRoom(connection.chatRoom, argv[0]);
			if (typeof target === "string") {
				if (/^[0-9]+$/.test(argv[0])) {
					const MemberNumber = Number.parseInt(argv[0], 10);
					if (connection.chatRoom.Ban.includes(MemberNumber)) {
						respond(`Target already banned.`);
					} else {
						respond(`Ok, target not in room.`);
						return connection.ChatRoomUpdate({
							Ban: _(connection.chatRoom.Ban.concat(MemberNumber)).uniq().sort().value()
						});
					}
				} else {
					respond(target);
				}
				return;
			} else {
				respond("Ok");
				connection.SendMessage("Emote", `*${target} has been banned by administrator.`);
				return target.Ban();
			}
		});

		this.registerSUCommand("resize", (connection, argv, sender, respond) => {
			if (argv.length !== 1) {
				return respond(`Size expected.`);
			}
			const size = Number.parseInt(argv[0], 10);
			if (isNaN(size) || !Number.isInteger(size) || size < 2 || size > 10) {
				return respond(`Invalid size "${size}".`);
			}
			respond("Ok");
			return connection.ChatRoomUpdate({
				Limit: size
			});
		});

		this.registerSUCommand("private", (connection, argv, sender, respond) => {
			if (argv.length !== 1) {
				return respond(`Value expected.`);
			}
			if (argv[0] !== "true" && argv[0] !== "false") {
				return respond(`Expected true or false.`);
			}
			respond("Ok");
			return connection.ChatRoomUpdate({
				Private: argv[0] === "true"
			});
		});

		this.registerSUCommand("list", (connection, argv, sender, respond) => {
			respond(
				`List of players in room:\n` +
				connection.chatRoom.characters.map(c => `${c}${c === connection.Player ? " - Me" : ""}`).join("\n")
			);
		});

		this.registerSUCommand("promoteme", (connection, argv, sender) => {
			return connection.ChatRoomUpdate({
				Admin: _.uniq(connection.chatRoom.Admin.concat(sender))
			});
		});

		//#endregion

		this.a_tickTimer = setInterval(this.a_Tick.bind(this), 1000);
	}

	destroy() {
		if (!this.a_destroyed) {
			this.a_destroyed = true;
			clearInterval(this.a_tickTimer);
		}
	}

	//#region Commands
	/**
	 * To register a new command for the adminLogic
	 * @param name The name of the command, how it is supposed to be typed by the user
	 * @param callback The call back that is triggered when the command is used in the format
	 * 				   of `(connection, args, sender) => functionUsingSomeOfTheseVariablesThatWillBeTriggered()`
	 * @param description The description of the command. It is intended that `null` means the command will be not showing up in the
	 *                    command list, either because it is an alias for another command using the same callback or it is a hidden one.
	 */
	protected registerCommand(name: string, callback: AdminCommandHandlerRaw, description: string | null = "") {
		name = name.toLocaleLowerCase();
		if (this.a_commands.has(name)) {
			throw new Error(`Command "${name}" already registered!`);
		}
		this.a_commands.set(name, {
			parse: false,
			callback,
			description
		});
	}

	/**
	 * To register a new command for the adminLogic, with argumetns parsed by logic itself
	 * @param name The name of the command, how it is supposed to be typed by the user
	 * @param callback The call back that is triggered when the command is used in the format
	 * 				   of `(connection, argv, sender) => functionUsingSomeOfTheseVariablesThatWillBeTriggered()`
	 * @param description The description of the command. It is intended that `null` means the command will be not showing up in the
	 *                    command list, either because it is an alias for another command using the same callback or it is a hidden one.
	 */
	protected registerCommandParsed(name: string, callback: AdminCommandHandlerParsed, description: string | null = "") {
		name = name.toLocaleLowerCase();
		if (this.a_commands.has(name)) {
			throw new Error(`Command "${name}" already registered!`);
		}
		this.a_commands.set(name, {
			parse: true,
			callback,
			description
		});
	}

	protected registerSUCommand(name: string, callback: AdminCommandHandlerSu) {
		name = name.toLocaleLowerCase();
		if (this.a_SUCommands.has(name)) {
			throw new Error(`Command "${name}" already registered!`);
		}
		this.a_SUCommands.set(name, callback);
	}

	/**
	 * To unregister an existing command for the adminLogic
	 * @param name The name of the command, how it is supposed to be typed by the user
	 * @returns `true` if unregistering was successful, otherwise `false`
	 */
	protected unregisterCommand(name: string): boolean {
		return this.a_commands.delete(name.toLocaleLowerCase());
	}

	private a_command_su(connection: API_Connector, argv: string[], sender: number, respond: (response: string) => void) {
		if (!SUPERUSERS.includes(sender)) {
			respond("You don't have access to administrator features!");
			return;
		}
		if (argv.length < 1) {
			respond("Command expected!");
			return;
		}
		const command = argv[0].toLocaleLowerCase();
		argv = argv.slice(1);
		const processor = this.a_SUCommands.get(command);
		if (!processor) {
			respond(`Admin command "${command}" not found!`);
			return;
		}
		try {
			const result = processor(connection, argv, sender, respond);
			if (result) {
				result.catch(err => {
					logger.fatal(
						`${this.a_LogHeader(connection)} CRASH during async processing of SU command "${command}". Logic: ${this.constructor.name}\n` +
						`Arguments: ${JSON.stringify(argv)}\nError: `,
						err
					);
				});
			}
		} catch (err) {
			logger.fatal(
				`${this.a_LogHeader(connection)} CRASH during processing of SU command "${command}". Logic: ${this.constructor.name}\n` +
				`Arguments: ${JSON.stringify(argv)}\nError: `,
				err
			);
		}
	}

	protected on_Help(sender: API_Character) {
		sender.Tell(
			"Whisper",
			`Available commands:\n` +
			Array.from(this.a_commands.entries())
				.filter(c => c[1].description !== null)
				.map(c => `!${c[0]}` + (c[1].description ? ` - ${c[1].description}` : ""))
				.sort()
				.join("\n")
		);
	}
	//#endregion

	//#region Voting
	protected startVote(name: string, room: API_Chatroom, time: number, options: {
		description?: string;
		announcmentMessage?: string | null;
		participants?: API_Character[];
		autoVoteYes?: API_Character[];
		autoVoteNo?: API_Character[];
		progress?: (data: IAdminVoteResults) => boolean;
	} = {}): Promise<IAdminVoteResults> {
		let newName = name;
		for (let i = 2; this.a_pendingVotes.has(newName); i++) {
			newName = `${name}_${i}`;
		}
		return new Promise((resolve) => {
			const participants = (options.participants ? options.participants.filter(p => room.characters.includes(p)) : room.characters.slice()).filter(p => !p.IsBot());
			const vote: IAdminVoteData = {
				name: newName,
				description: options.description || "",
				endTime: Date.now() + time * 1000,
				votes: new Map(participants.map(p => [p, options.autoVoteYes?.includes(p) ? true : options.autoVoteNo?.includes(p) ? false : null])),
				progress: options.progress,
				resolve
			};
			this.a_pendingVotes.set(newName, vote);
			if (options.announcmentMessage !== null) {
				for (const participant of participants) {
					const targetVote = vote.votes.get(participant);
					participant.Tell(
						"Chat",
						`===== A new vote has started! =====\n` +
						`Vote name: ${vote.name}      Time left: ${Math.floor((vote.endTime - Date.now()) / 1000)}s\n` +
						(options.announcmentMessage ?? vote.description) +
						`\n\n` +
						(targetVote === null ?
							`To submit your vote, whisper one of these to the bot:\n!yes ${vote.name}\n!no ${vote.name}` :
							`You have automatically voted ${targetVote ? "yes" : "no"} for this vote`
						) +
						`\n===================================`
					);
				}
			}
		});
	}

	private a_makeVoteResults(voteData: IAdminVoteData): IAdminVoteResults {
		const res: IAdminVoteResults = {
			name: voteData.name,
			yes: 0,
			no: 0,
			didNotVote: 0
		};
		for (const v of voteData.votes.values()) {
			if (v === null) {
				res.didNotVote++;
			} else if (v) {
				res.yes++;
			} else {
				res.no++;
			}
		}
		return res;
	}

	private a_CharacterVote(vote: boolean, connection: API_Connector, args: string, sender: API_Character) {
		const voteData = this.a_pendingVotes.get(args.trim());
		if (!voteData) {
			sender.Tell("Whisper", "No such vote found. To see currently ongoing votes, use '!listvotes'");
			return;
		}
		if (!voteData.votes.has(sender)) {
			sender.Tell("Whisper", "You are not eligible to vote in this vote.");
			return;
		}
		const res = voteData.votes.get(sender);
		if (res !== null) {
			sender.Tell("Whisper", `You already voted ${res ? "yes" : "no"} in this vote. Votes cannot be changed.`);
			return;
		}
		voteData.votes.set(sender, vote);
		sender.Tell("Whisper", "Vote accepted");
		let end = false;
		if (voteData.progress) {
			end = voteData.progress(this.a_makeVoteResults(voteData));
		}
		if (!end && Array.from(voteData.votes.values()).every(v => v !== null)) {
			end = true;
		}
		if (end) {
			this.a_endVote(voteData);
		}
	}

	private a_command_listVotes(connection: API_Connector, args: string, sender: API_Character) {
		if (this.a_pendingVotes.size === 0) {
			sender.Tell("Whisper", "There are currently no ongoing votes");
			return;
		}
		sender.Tell(
			"Whisper",
			`List of currently ongoing votes: \n` +
			Array.from(this.a_pendingVotes.values())
				.map((v) => `> "${v.name}" ${v.description ? `- ${v.description} ` : ""}(${Math.floor((v.endTime - Date.now()) / 1000)}s left)`)
				.join("\n") +
			(Array.from(this.a_pendingVotes.values()).some(v => v.votes.get(sender) === null) ?
				`\n\nTo vote whisper one of the following commands to the bot:\n` +
				`'!yes <vote name>' / '!no <vote name>'`
				: "")
		);
	}

	private a_endVote(vote: IAdminVoteData) {
		if (!this.a_pendingVotes.delete(vote.name)) {
			throw new Error(`Attempt to end non-pending vote "${vote.name}"`);
		}
		vote.resolve(this.a_makeVoteResults(vote));
	}
	//#endregion

	protected identifyPlayerInRoom(room: API_Chatroom, identifier: string): API_Character | string {
		if (/^[0-9]+$/.test(identifier)) {
			const MemberNumber = Number.parseInt(identifier, 10);
			const target = room.characters.find(c => c.MemberNumber === MemberNumber);
			if (!target) {
				return `Could not find player #${MemberNumber} in room`;
			}
			return target;
		}
		let targets = room.characters.filter(c => c.Name === identifier);
		if (targets.length === 0)
			targets = room.characters.filter(c => c.Name.toLocaleLowerCase() === identifier.toLocaleLowerCase());
		if (targets.length === 0)
			targets = room.characters.filter(c => c.Name.toLocaleLowerCase().startsWith(identifier.toLocaleLowerCase()));

		if (targets.length === 1) {
			return targets[0];
		} else if (targets.length === 0) {
			return `Player "${identifier}" not found in room`;
		} else {
			return `Multiple players match "${identifier}". Please use Member Number instead.`;
		}
	}

	//#region Kickvoting
	private a_command_kick(ban: boolean, connection: API_Connector, args: string, sender: API_Character) {
		const targetMatch = /^(\S+)(?:\s|$)(.*)$/.exec(args);
		if (!targetMatch) {
			sender.Tell("Whisper", `Expected format: !${ban ? "ban" : "kick"} <target> [Reason]`);
			return;
		}
		const target = this.identifyPlayerInRoom(sender.chatRoom, targetMatch[1]);
		if (typeof target === "string") {
			sender.Tell("Whisper", `Failed to start vote:\n${target}`);
			return;
		}

		if (target === sender) {
			sender.Tell("Whisper", "You know you can just leave the room, right?");
			return;
		}

		if (target.IsRoomAdmin()) {
			sender.Tell("Whisper", `Failed to start vote:\nRoom administrators cannot be kicked/banned.`);
			return;
		}

		const protectedUntil = this.a_kickProtection.get(target);
		if (protectedUntil != null && protectedUntil > Date.now()) {
			sender.Tell(
				"Whisper",
				`Failed to start vote:\n` +
				`${target} was already subject of a recent voting. You need to wait a few minutes before you can start the same vote again.`
			);
			return;
		}

		const canBeBannedUntil = this.a_banAvailability.get(target.MemberNumber);
		if (canBeBannedUntil != null && canBeBannedUntil >= Date.now()) {
			if (!ban && this.a_notBanComfirmation.get(sender) !== target.MemberNumber) {
				sender.Tell(
					"Whisper",
					`Note:\n` +
					`${target} was already recently kicked from this room. This means you can start a ban vote instead with '!ban ${target.MemberNumber}'.\n` +
					`If you wish to still only kick target, repeat the command '!kick ${args}'`
				);
				this.a_notBanComfirmation.set(sender, target.MemberNumber);
				return;
			}
		} else if (ban) {
			sender.Tell(
				"Whisper",
				`Failed to start vote:\n` +
				`${target} hasn't been recently kicked from room. Players need to have been kicked recently to be able to ban them`
			);
			return;
		}

		const reason = targetMatch[2];
		const voteName = `${ban ? "ban" : "kick"} ${target.MemberNumber}`;
		this.a_kickProtection.set(target, Date.now() + KICKVOTE_PROTECTION_DURATION * 1000);
		this.startVote(voteName, target.chatRoom, KICKVOTE_DURATION, {
			description: `Vote to ${ban ? "ban" : "kick"} ${target}`,
			announcmentMessage: `${sender} started vote to ${ban ? "ban" : "kick"} ${target}!\n` +
				`Reason: ${reason}`,
			autoVoteYes: [sender],
			autoVoteNo: [target],
			progress: ({ yes, no, didNotVote }) => yes > no + didNotVote || no >= yes + didNotVote
		}).then(result => {
			if (target.IsRoomAdmin()) {
				// Silently fail kick vote, if target became admin
				return;
			}
			if (result.yes > result.no + result.didNotVote) {
				connection.SendMessage("Chat",
					`Player ${target} ${ban ? "ban" : "kick"} vote passed.\n` +
					`Yes: ${result.yes}  No: ${result.no}  Did not vote: ${result.didNotVote}`
				);
				if (!ban) {
					this.a_banAvailability.set(target.MemberNumber, Date.now() + KICKVOTE_BAN_AVAILABILITY * 1000);
				}
				const target2 = connection.chatRoom.characters.find(c => c.MemberNumber === target.MemberNumber);
				if (target2) {
					if (ban) {
						void target2.Ban();
					} else {
						void target2.Kick();
					}
				} else if (ban) {
					void connection.ChatRoomUpdate({
						Ban: _(connection.chatRoom.Ban.concat(target.MemberNumber)).uniq().sort().value()
					});
				}
			} else {
				connection.SendMessage("Chat",
					`Player ${target} ${ban ? "ban" : "kick"} vote failed.\n` +
					`Yes: ${result.yes}  No: ${result.no}  Did not vote: ${result.didNotVote}`
				);
			}
		}, logger.fatal.bind(logger));
	}
	//#endregion

	private a_command_feedback(connection: API_Connector, args: string, sender: API_Character) {
		const message = args.trim();
		if (!message) {
			sender.Tell("Whisper", `Expected format: !feedback <message>`);
			return;
		}
		sender.Tell("Whisper", "Your feedback has been saved, thank you!");
		const msg = `${this.a_LogHeader(connection)} Feedback: ${sender}\n${message}`;
		logger.alert(msg);
		fs.writeFileSync("./data/messagelog.txt", msg + "\n\n", { flag: "a", encoding: "utf8" });
	}

	private a_Tick() {
		const now = Date.now();
		for (const vote of Array.from(this.a_pendingVotes.values())) {
			if (now >= vote.endTime) {
				this.a_endVote(vote);
			}
		}

		if (this.a_settings.inactivityKickTimer !== null) {
			for (const [character, lastActivity] of this.a_lastActivity.entries()) {
				if (
					character.IsRoomAdmin() ||
					character.chatRoom.Private ||
					(
						this.a_settings.inactivityKickEnabledOnlyBelowFreeSlotsCount !== null &&
						character.chatRoom.Limit - character.chatRoom.charactersCount >= this.a_settings.inactivityKickEnabledOnlyBelowFreeSlotsCount
					)
				) continue;
				if (
					this.a_settings.inactivityWarningTimer !== null &&
					now >= lastActivity + this.a_settings.inactivityWarningTimer &&
					!this.a_inactivityDidWarn.has(character)
				) {
					this.a_inactivityDidWarn.add(character);
					character.Tell("Chat",
						`===== Inactivity warning! =====\n` +
						`You have been inactive for quite a while. If you continue being inactive, you will soon ` +
						`be kicked from the room to make space for others who want to enjoy it.` +
						`\n===============================`
					);
					// Make sure players are warned correct time before being kicked
					this.a_lastActivity.set(character, now - this.a_settings.inactivityWarningTimer);
				} else if (now >= lastActivity + this.a_settings.inactivityKickTimer) {
					character.connection.SendMessage("Emote", `*${character} has been kicked due to inactivity.`);
					void character.Kick();
				}
			}
		}
	}

	private a_LogHeader(connection: API_Connector): string {
		return `[A] [${connection.chatRoom.Name}]` + (this.a_settings.logConnectionMemberNumber ? ` [${connection.Player.MemberNumber}]` : "") + (this.a_settings.logConnectionName ? ` [${connection.username}]` : "");
	}

	private a_onMessage(event: LogicEvent_Message): boolean {
		if (this.a_settings.log) {
			const dict = event.message.Dictionary === undefined ? "" : `; dict: ${JSON.stringify(event.message.Dictionary)}`;
			if (event.message.Type !== "Hidden") {
				const msg = `${this.a_LogHeader(event.connection)} Message ${event.message.Type} ` +
					`from ${event.Sender.Name} (${event.Sender.MemberNumber}): ` +
					`${event.message.Content} ${dict}`;
				if (event.Sender.IsBot() || event.message.Type === "Action" && ["ActionUse", "ActionRemove"].includes(event.message.Content)) {
					logger.debug(msg);
				} else if (["Chat", "Emote", "Whisper"].includes(event.message.Type)) {
					logger.info(msg);
				} else {
					logger.verbose(msg);
				}
			}
		}

		if (["Chat", "Whisper", "Emote"].includes(event.message.Type)) {
			this.a_lastActivity.set(event.Sender, Date.now());
			this.a_inactivityDidWarn.delete(event.Sender);
		}

		//#region Commands handling
		if (event.message.Type === "Whisper" && event.message.Content.startsWith("!")) {
			const commandMatch = /^!\s*(\S+)(?:\s|$)(.*)$/.exec(event.message.Content);
			if (commandMatch) {
				const command = commandMatch[1].toLocaleLowerCase();
				const args = commandMatch[2];
				const commandInfo = this.a_commands.get(command);
				if (!commandInfo) {
					// Command not found
					if (this.a_settings.catchUnknownCommands) {
						event.Sender.Tell(
							"Whisper",
							`Unknown command "${command}"\n` +
							`To see list of valid commands whisper '!help'`
						);
						return true;
					}
				} else if (commandInfo.parse) {
					const argv = [...args.matchAll(/".+?(?:"|$)|'.+?(?:'|$)|[^ ]+/g)]
						.map(a => a[0])
						.map(a => a[0] === '"' || a[0] === "'" ? a.substring(1, a[a.length - 1] === a[0] ? a.length - 1 : a.length) : a);
					try {
						const result = commandInfo.callback(event.connection, argv, event.Sender);
						if (result) {
							result.catch(err => {
								logger.fatal(
									`${this.a_LogHeader(event.connection)} CRASH during async processing of command "${command}". Logic: ${this.constructor.name}\n` +
									`Arguments: ${JSON.stringify(argv)}\nError: `,
									err
								);
							});
						}
					} catch (err) {
						logger.fatal(
							`${this.a_LogHeader(event.connection)} CRASH during processing of command "${command}". Logic: ${this.constructor.name}\n` +
							`Arguments: ${JSON.stringify(argv)}\nError: `,
							err
						);
					}
				} else {
					try {
						const result = commandInfo.callback(event.connection, args, event.Sender);
						if (result) {
							result.catch(err => {
								logger.fatal(
									`${this.a_LogHeader(event.connection)} CRASH during async processing of command "${command}". Logic: ${this.constructor.name}\n` +
									`Arguments: ${JSON.stringify(args)}\nError: `,
									err
								);
							});
						}
					} catch (err) {
						logger.fatal(
							`${this.a_LogHeader(event.connection)} CRASH during processing of command "${command}". Logic: ${this.constructor.name}\n` +
							`Arguments: ${JSON.stringify(args)}\nError: `,
							err
						);
					}
					return true;
				}
			}
		}
		//#endregion

		return false;
	}

	private a_onCharacterLeft(event: LogicEvent_CharacterLeft): boolean {
		if (this.a_settings.log) {
			const resolvedCharacter = event.sourceMemberNumber !== undefined ?
				event.connection.chatRoom.characters.find(c => c.MemberNumber === event.sourceMemberNumber) :
				undefined;
			const byStr = event.sourceMemberNumber !== undefined ?
				resolvedCharacter !== undefined ? ` by ${resolvedCharacter.Name} (${resolvedCharacter.MemberNumber})` :
					` by (${event.sourceMemberNumber})` :
				"";
			logger.info(`${this.a_LogHeader(event.connection)} Left: ` +
				`${event.character.Name} (${event.character.MemberNumber}), ` +
				`reason: ${event.leaveMessage}` + byStr
			);
		}

		this.a_lastActivity.delete(event.character);
		this.a_inactivityDidWarn.delete(event.character);

		return false;
	}

	private a_onCharacterEntered(event: LogicEvent_CharacterEntered): boolean {
		if (this.a_settings.log) {
			logger.info(`${this.a_LogHeader(event.connection)} Entered: ` +
				`${event.character.Name} (${event.character.MemberNumber})`
			);
			const curseVersion = event.character.getCurseVersion();
			if (curseVersion !== null) {
				logger.verbose(`${this.a_LogHeader(event.connection)} ${event.character.Name} (${event.character.MemberNumber})` +
					` uses curse version: ${curseVersion}`
				);
			}
		}

		// Fix old character references in votes
		for (const vote of this.a_pendingVotes.values()) {
			const oldCharacter = Array.from(vote.votes.keys()).find(c => c.MemberNumber === event.character.MemberNumber);
			if (oldCharacter) {
				vote.votes.set(event.character, vote.votes.get(oldCharacter)!);
				vote.votes.delete(oldCharacter);
			}
		}

		this.a_lastActivity.set(event.character, Date.now());

		return false;
	}

	private a_onRoomForceLeave(event: LogicEvent_RoomForceLeave): boolean {
		if (this.a_settings.log) {
			const player = event.connection.Player;
			logger.alert(`${this.a_LogHeader(event.connection)} Bot ${player.Name} (${player.MemberNumber}) was ${event.type.toLowerCase()} from room\n` +
				`Present room admins: ${event.connection.chatRoom.characters.filter(c => c.IsRoomAdmin()).map(c => `${c.Name} (${c.MemberNumber})`).join(", ")}`);
		}
		return false;
	}

	private a_onRoomUpdate(event: LogicEvent_RoomUpdate): boolean {
		const newInfo = event.connection.chatRoom.ToInfo() as any;
		const oldInfo = event.oldInfo as any;
		const resolvedCharacter = event.connection.chatRoom.characters.find(c => c.MemberNumber === event.sourceMemberNumber);
		const byStr = resolvedCharacter !== undefined ?
			`${resolvedCharacter.Name} (${resolvedCharacter.MemberNumber})` :
			`(${event.sourceMemberNumber})`;
		let txt = `${this.a_LogHeader(event.connection)} Room update by ${byStr}:`;
		for (const k of Object.keys(newInfo)) {
			if (!_.isEqual(oldInfo[k], newInfo[k])) {
				txt += `\n${k}: ${JSON.stringify(oldInfo[k])} -> ${JSON.stringify(newInfo[k])}`;
			}
		}
		logger.info(txt);
		return false;
	}

	private a_onCharacterEvent(connection: API_Connector, event: AnyCharacterEvent): boolean {
		let msg = "";
		let fromBot = false;
		if (event.name === "ItemAdd" && !event.initial) {
			const target = event.character === event.source ? "herself" : `${event.character.Name} (${event.character.MemberNumber})`;
			fromBot = event.source.IsBot();
			const itemName = `${event.item.Group}:${event.item.Name}`;
			msg = `${this.a_LogHeader(connection)} ItemAdd ${event.source.Name} (${event.source.MemberNumber}) on ${target}: ${itemName}`;
		} else if (event.name === "ItemRemove") {
			const target = event.character === event.source ? "herself" : `${event.character.Name} (${event.character.MemberNumber})`;
			fromBot = event.source.IsBot();
			const itemName = `${event.item.Group}:${event.item.Name}`;
			msg = `${this.a_LogHeader(connection)} ItemRemove ${event.source.Name} (${event.source.MemberNumber}) from ${target}: ${itemName}`;
		} else if (event.name === "ItemChange" && !event.initial) {
			const target = event.character === event.source ? "herself" : `${event.character.Name} (${event.character.MemberNumber})`;
			fromBot = event.source.IsBot();
			let itemName = `${event.item.Group}:${event.item.Name}` + (event.item.Extended?.Type != null ? `:${event.item.Extended.Type}` : "");
			if (event.item.Asset.AllowExpression || event.item.AssetGroup.AllowExpression) {
				itemName += ":" + (event.item.GetExpression() ?? "null");
			}
			msg = `${this.a_LogHeader(connection)} ItemChange ${event.source.Name} (${event.source.MemberNumber}) on ${target}: ${itemName}`;
		} else if (event.name === "PoseChanged" && !event.character.IsBot()) {
			logger.debug(`${this.a_LogHeader(connection)} PoseChange ${event.character.Name} (${event.character.MemberNumber}): ` +
				event.character.Pose.map(p => p.Name).join(",")
			);
		} else if (event.name === "SafewordUsed") {
			logger.alert(`${this.a_LogHeader(connection)} ${event.character.Name} (${event.character.MemberNumber}) used swafeword! (full release: ${event.release})`);
		}

		if (msg) {
			if (fromBot) {
				logger.debug(msg);
			} else {
				logger.verbose(msg);
			}
		}

		return false;
	}

	private a_onBeep(event: LogicEvent_Beep): boolean {
		if (event.beep.BeepType == null &&
			typeof event.beep.Message === "string" &&
			SUPERUSERS.includes(event.beep.MemberNumber)
		) {
			for (const pfx of ["!admin ", "!su ", "!sudo "]) {
				if (event.beep.Message.toLocaleLowerCase().startsWith(pfx)) {
					const argv = [...event.beep.Message.substr(pfx.length).matchAll(/".+?(?:"|$)|'.+?(?:'|$)|[^ ]+/g)]
						.map(a => a[0])
						.map(a => a[0] === '"' || a[0] === "'" ? a.substring(1, a[a.length - 1] === a[0] ? a.length - 1 : a.length) : a);
					this.a_command_su(event.connection, argv, event.beep.MemberNumber, response => event.connection.AccountBeep(event.beep.MemberNumber, null, response));
					return true;
				}
			}
		}
		return false;
	}

	private a_processEvent(event: AnyLogicEvent): boolean {
		if (event.name === "Message") {
			return this.a_onMessage(event);
		} else if (event.name === "CharacterLeft") {
			return this.a_onCharacterLeft(event);
		} else if (event.name === "CharacterEntered") {
			return this.a_onCharacterEntered(event);
		} else if (event.name === "RoomForceLeave") {
			return this.a_onRoomForceLeave(event);
		} else if (event.name === "RoomUpdate") {
			return this.a_onRoomUpdate(event);
		} else if (event.name === "CharacterEvent") {
			return this.a_onCharacterEvent(event.connection, event.event);
		} else if (event.name === "Beep") {
			return this.a_onBeep(event);
		}
		return false;
	}

	public onEvent(event: AnyLogicEvent): void {
		if (!this.a_processEvent(event)) {
			return super.onEvent(event);
		}
	}
}
