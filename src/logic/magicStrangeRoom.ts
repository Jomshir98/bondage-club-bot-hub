/* eslint-disable no-constant-condition */
import { AssetGet, BC_PermissionLevel, logger, LogicBase } from "bondage-club-bot-api";

enum StoryProgress {
	/** Beginning */
	beggining = 0,
	/** The Domme and The Sub */
	dommeAndSub = 10,
	/** Dominance Failure & Betrayal */
	dommeFail = 20,
	/** The Mistress and The Slave */
	mistressAndSlave = 30,
	/** Will of submission */
	willOfSubmission = 50
}

enum SaveSlave {
	noSave = 0,
	askedQuestion = 1,
	willSave = 2,
	willSaveConfirm = 3
}

type RoomPosition =
	| "room1"
	| "desk"
	| "right_drawer_open"
	| "middle_drawer_open"
	| "mirror"
	| "wooden boxes"
	| "wooden boxes 2"
	| "device"
	| "inside box"
	| "imprisoned";

/**
 * comprare two arrays until the last element of array1. If array2 is longer the remaining elements are ignored
 */
function customCompareArray(array1: number[], array2: number[]): boolean {
	for (let i = 0; i < array1.length; i++) {
		if (array1[i] !== array2[i]) return false;
	}
	return true;
}

function customInventoryGroupIsBlocked(C: API_Character, GroupName: AssetGroupItemName, ignoreItemArray: string[] = []) {
	// in this case C is ChatRoomCharacter
	// Items can block each other (hoods blocks gags, belts blocks eggs, etc.)
	for (const E of C.Appearance.Appearance) {
		if (ignoreItemArray.includes(E.Asset.Name)) continue;
		if (!E.Asset.Group.Clothing && E.GetBlock().includes(GroupName)) return true;
	}

	// Nothing is preventing the group from being used
	return false;

}

function InventoryDoItemsExposeGroup(C: API_Character, TargetGroup: AssetGroupName, GroupsToCheck: AssetGroupName[]): boolean {
	return GroupsToCheck.every((Group) => {
		const Item = C.Appearance.InventoryGet(Group);
		return !Item || Item.Asset.Expose.includes(TargetGroup);
	});
}

function InventoryDoItemsBlockGroup(C: API_Character, TargetGroup: AssetGroupItemName, GroupsToCheck: AssetGroupName[]): boolean {
	return GroupsToCheck.some((Group) => {
		const Item = C.Appearance.InventoryGet(Group);
		return Item && Item.Asset.Block && Item.Asset.Block.includes(TargetGroup);
	});
}

function isExposed(C: API_Character, ignoreItemArray: string[] = []): boolean {
	return (
		InventoryDoItemsExposeGroup(C, "ItemBreast", ["Cloth"]) &&
		InventoryDoItemsExposeGroup(C, "ItemBreast", ["Bra"]) &&
		!InventoryDoItemsBlockGroup(C, "ItemVulva", ["Cloth", "Socks", "ItemPelvis", "ItemVulvaPiercings"]) &&
		InventoryDoItemsExposeGroup(C, "ItemVulva", ["ClothLower", "Panties"]) &&
		!customInventoryGroupIsBlocked(C, "ItemNipples") &&
		!customInventoryGroupIsBlocked(C, "ItemVulva", ignoreItemArray)
	);
}

function CharacterIsInUnderwear(C: API_Character) {
	for (const A of C.Appearance.Appearance)
		if ((A.Asset != null) && (A.Asset.Group.Category === "Appearance") && A.Asset.Group.AllowNone && !A.Asset.BodyCosplay && !A.Asset.Group.BodyCosplay)
			if (!A.Asset.Group.Underwear)
				if (!(A.Asset.Group.BodyCosplay && C.OnlineSharedSettings && C.OnlineSharedSettings.BlockBodyCosplay))
					return false;
	return true;
}

function removeRestrains(target: API_Character) {
	target.Appearance.RemoveItem("ItemVulva");
	target.Appearance.RemoveItem("ItemButt");
	target.Appearance.RemoveItem("ItemArms");
	target.Appearance.RemoveItem("ItemHands");
	target.Appearance.RemoveItem("ItemNeck");
	target.Appearance.RemoveItem("ItemMouth");
	target.Appearance.RemoveItem("ItemMouth2");
	target.Appearance.RemoveItem("ItemMouth3");
	target.Appearance.RemoveItem("ItemTorso");
	target.Appearance.RemoveItem("ItemLegs");
	target.Appearance.RemoveItem("ItemFeet");
	target.Appearance.RemoveItem("ItemBoots");
	target.Appearance.RemoveItem("ItemNipplesPiercings");
	target.Appearance.RemoveItem("ItemPelvis");
	target.Appearance.RemoveItem("ItemHead");
	target.Appearance.RemoveItem("ItemDevices");
}

function free(target: API_Character, reapplyCloth: boolean = true): void {
	removeRestrains(target);
	// if (reapplyCloth)
	// TODO
	// reapplyClothing(target);
}

function lookLikeSlave(char: API_Character): boolean {
	return (
		isExposed(char, ["PolishedChastityBelt"]) &&
		char.IsKneeling() &&
		char.Appearance.InventoryGet("ItemMouth")?.Asset.Name === "HarnessBallGag" &&
		char.Appearance.InventoryGet("ItemArms")?.Asset.Name === "LeatherArmbinder"
	);
}

function dressLikeMistress(char: API_Character): boolean {
	return (
		char.Appearance.InventoryGet("Shoes")?.Asset.Name === "MistressBoots" &&
		char.Appearance.InventoryGet("ClothLower")?.Asset.Name === "MistressBottom" &&
		char.Appearance.InventoryGet("Gloves")?.Asset.Name === "MistressGloves" &&
		char.Appearance.InventoryGet("Cloth")?.Asset.Name === "MistressTop"
	);
}


export class MagicStrangeRoom extends LogicBase {
	/** List of imprisioned people */
	imprisonedList: Set<number> = new Set();
	/** Map of active characters */
	charDict: Map<number, API_Character> = new Map();
	/** Map of current player's position in room */
	charPos: Map<number, RoomPosition> = new Map();
	/** Active players */
	charList: number[] = [];
	deviceAvailable: boolean = false;
	dildoInserting: boolean = false;
	dildoIntensity: number = -1;
	/**  the member number of the player with the dildo inside. 0 if noone */
	dildoInside: API_Character | null = null;
	dildoLocked: boolean = false;
	/** -1 is red, 0 blue and 1 is green. Multiply the array *-1 and you obtain the alternative code that does "something different". */
	correctCode: number[] = [];
	alternativeCode: number[] = [];
	insertedCode: number[] = [];
	woodenBoxOpen: boolean = false;
	tabletActive: boolean = false;
	storyProgress: StoryProgress = StoryProgress.beggining;
	lockCode: number = 0;
	saveSlave: SaveSlave = SaveSlave.noSave;

	readonly conn: API_Connector;

	constructor(conn: API_Connector) {
		super();
		this.conn = conn;
		this.resetRoom();
	}

	resetRoom() {
		this.charDict.clear();
		this.charPos.clear();
		this.charList = [];
		this.deviceAvailable = false;
		this.dildoInserting = false;
		this.dildoIntensity = -1;
		this.dildoInside = null;
		this.dildoLocked = false;
		this.resetCode();
		this.woodenBoxOpen = false;
		this.tabletActive = false;
		this.storyProgress = StoryProgress.beggining;
		this.lockCode = Math.floor(Math.random() * 9000 + 1000);
		this.saveSlave = SaveSlave.noSave;
	}

	resetCode() {
		this.correctCode = Array.from({ length: 5 }, () => Math.floor(Math.random() * 3) - 1);
		this.alternativeCode = this.correctCode.map(x => -x);
		this.insertedCode = [];
	}

	nextColor(): string {
		const next = this.correctCode[this.insertedCode.length];
		if (next === -1) {
			return "blue";
		} else if (next === 0) {
			return "red";
		} else if (next === 1) {
			return "green";
		}
		return "unknown";

		//return ["blue", "red", "green"][this.correctCode[this.insertedCode.length] + 1];
	}

	/**
	 * When character enters the room
	 * @param connection Originating connection
	 * @param character The character that entered the room
	 */
	protected onCharacterEntered(connection: API_Connector, character: API_Character): void {
		if (isExposed(character) || character.IsRestrained() || CharacterIsInUnderwear(character) || character.IsChaste() || character.IsShackled() || character.IsBlind() || !character.CanTalk() || character.IsEnclose() || character.IsMounted() || character.IsEgged() || character.IsDeaf()) {
			character.Tell("Emote", "*[To play here you have to be UNRESTRAINED and fully DRESSED. You will be kicked in 10 seconds. You can change and comeback if you want.]");
			setTimeout(() => { void character.Kick(); }, 10 * 1000);
		} else if (character.ItemPermission > BC_PermissionLevel.OwnerLoverWhitelistDominant) {
			character.Tell("Emote", "*[To play here you have to lower your PERMISSION. You will be kicked in 10 seconds. You can change and comeback if you want.]");
			setTimeout(() => { void character.Kick(); }, 10 * 1000);
		} else if (!character.IsItemPermissionAccessible(AssetGet("ItemDevices", "SmallWoodenBox")) || !character.IsItemPermissionAccessible(AssetGet("ItemPelvis", "PolishedChastityBelt"))) {
			character.Tell("Emote", "**[To play here you have to give PERMISSION to use the SMALL WOODEN BOX and POLISHED CHASTITY BELT. You will be kicked in 10 seconds. You can change and comeback if you want.]");
			setTimeout(() => { void character.Kick(); }, 10 * 1000);
		}
		if (this.charList.length >= 2) {
			logger.error("New player entered, but all slots are already filled.");
			return;
		}
		character.Tell("Emote", "*As you enter the room you feel watched. You look around but you cannot find the source of that feeling.");
		this.charList.push(character.MemberNumber);
		this.charDict.set(character.MemberNumber, character);
		this.charPos.set(character.MemberNumber, "room1");
		if (this.charList.length < 2) {
			this.conn.SendMessage(
				"Emote",
				"*Other than the strange feeling you have, nothing is happening at the moment. For now at least."
			);
		} else {
			void this.conn.ChatRoomUpdate({
				Private: false,
				Locked: true
			});
			this.conn.SendMessage("Emote", "*You hear the door shutting down. The two of you are now locked inside.");
			this.conn.SendMessage("Emote", "*You can only (explore) the room. [NOTE: use the * to make actions]");
			this.conn.SendMessage(
				"Emote",
				"Remember that if you are lost you can always surrender. Just say 'I wish to surrender'. Have fun!"
			);
		}
	}

	public getPartner(char: API_Character): API_Character {
		if (this.charList.length < 2) throw new Error("Not enough players");
		const res = this.charDict.get(this.charList[this.charList[0] === char.MemberNumber ? 1 : 0]);
		if (res === undefined) throw new Error("No partner");
		return res;
	}

	public roomActive(contestant: API_Character): boolean {
		return this.charList.length === 2 && this.charList.includes(contestant.MemberNumber);
	}

	/**
	 * When character leaves the room
	 * @param connection Originating connection
	 * @param character The character that left the room
	 * @param intentional If the leave was (likely) caused by user
	 */
	protected onCharacterLeft(connection: API_Connector, character: API_Character, intentional: boolean): void {
		if (this.imprisonedList.has(character.MemberNumber)) {
			this.imprisonedList.delete(character.MemberNumber);
		} else if (this.charList.includes(character.MemberNumber)) {
			for (const C of connection.chatRoom.characters) {
				if (this.charList.includes(C.MemberNumber) && !this.imprisonedList.has(C.MemberNumber)) {
					free(C);
				}
			}
			this.conn.SendMessage("Emote", "*[RESET: sorry one player left the game. It needs to be reset.]");
			this.resetRoom();
		}
	}

	/**
	 * When connection receives message inside chatroom
	 * @param connection Originating connection
	 * @param message Received message
	 * @param sender The character that sent the message
	 */
	protected onMessage(connection: API_Connector, message: BC_Server_ChatRoomMessage, sender: API_Character): void {
		const msg = message.Content.toLocaleLowerCase();
		if (
			message.Type === "Chat" &&
			this.storyProgress === StoryProgress.beggining &&
			msg.includes("i wish to surrender") &&
			this.roomActive(sender)
		) {
			if (sender.IsKneeling()) {
				if (sender.Appearance.InventoryGet("ItemMouth")?.Asset.Name === "HarnessBallGag" && sender.Appearance.InventoryGet("ItemArms")?.Asset.Name === "LeatherArmbinder") {
					const partner = this.getPartner(sender);
					this.conn.SendMessage(
						"Chat",
						`Oh, You are so cute! And what do you think ${partner.Name}? Do you wish it too? [SAY: I wish to surrender]`
					);
				} else {
					this.conn.SendMessage(
						"Chat",
						"Well, that's something every good submissive wishes *giggles*. " +
						"And since I promised to give you some help: you can find some nice restraints on the desk, just put them on. Have fun!"
					);
				}
			} else {
				this.conn.SendMessage("Chat", "Okay, but I want you to kneel while you say that. *giggles*");
			}
		} else if (
			message.Type === "Chat" &&
			this.storyProgress === StoryProgress.dommeAndSub &&
			sender.IsKneeling() &&
			isExposed(sender) &&
			this.roomActive(sender) &&
			msg.includes("i am sorry that i was not a true mistress and i deserve this shameful punishment")
		) {
			this.conn.SendMessage("Chat", "Hihi. You are so cute! Of course I will give you the code. You are such a nice pet. *giggles*");
			sender.Tell("Whisper", `The code is: ${this.lockCode.toString().padStart(4, "0")}.`);
		} else if (message.Type === "Emote" || message.Type === "Action") {
			this.commandHandler(sender, msg);
		} else if (message.Type === "Whisper" && sender.Appearance.InventoryGet("ItemMouth")?.Asset.Name === "HarnessBallGag" && this.roomActive(sender)) {
			const partner = this.getPartner(sender);
			if (msg.includes("save me")) {
				if (this.storyProgress > 0) {
					sender.Tell("Whisper", "Ahaha! NOW you want to be saved? Too late sweety, enjoy your new life.");
				} else {
					sender.Tell(
						"Whisper",
						`You will save yourself, but ${partner.Name} will receive the punishment in your place. Don't you want to be a good submissive for ${partner.Name}? Are you sure of your decision? If you want to think about it you can answer 'no', but don't take too much time or it may be too late. [whisper: yes or no]`
					);
					this.saveSlave = SaveSlave.askedQuestion;
				}
			} else if (this.saveSlave === SaveSlave.askedQuestion && msg.includes("yes")) {
				sender.Tell(
					"Whisper",
					`Then, you will be spared sweety. Poor ${partner.Name}, seems you didn't find her worthy of your submission.`
				);
				this.saveSlave = SaveSlave.willSave;
			} else if (this.saveSlave === SaveSlave.askedQuestion && msg.includes("no")) {
				sender.Tell("Whisper", "Hihi, it's always a pleasure seeing a good submissive understanting her place. Have fun!");
				this.saveSlave = SaveSlave.noSave;
			} else if (this.saveSlave === SaveSlave.willSaveConfirm && msg.includes("yes")) {
				sender.Tell("Whisper", "Oh, well. You will soon be freed then. *kiss*");
				this.saveSlave = SaveSlave.noSave;
			} else if (this.saveSlave === SaveSlave.willSaveConfirm && msg.includes("no")) {
				sender.Tell("Whisper", `Good, seems that ${partner.Name} has earned your devotion. You may become good slave for her.`);
				this.saveSlave = SaveSlave.willSave;
			}
		}
	}

	canMove(sender: API_Character, msg: string): boolean {
		if (sender.IsKneeling() && !msg.toLowerCase().includes("crawl")) {
			sender.Tell("Emote", "*Private: You cannot walk while kneeling, you will have to (crawl to) or (crawl back).");
			return false;
		} else if (!sender.CanWalk() && !msg.toLowerCase().includes("hop")) {
			sender.Tell("Emote", "*Private: You cannot walk, you will have to (hop to) or (hop back).");
			return false;
		}
		return true;
	}

	commandHandler(sender: API_Character, msg: string) {
		if (!this.roomActive(sender)) return;
		const partner = this.getPartner(sender);

		if (msg.includes("i wish to surrender")) {
			sender.Tell("Emote", "*Private: you have to SAY it.");
			return;
		}

		switch (this.charPos.get(sender.MemberNumber)) {
			case "room1":
				if (msg.includes("explore")) {
					this.conn.SendMessage("Emote", `*${sender.Name} explores the room.`);
					this.backToRoom1(sender, msg);
				} else if (msg.includes("desk")) {
					if (!this.canMove(sender, msg)) return;
					this.charPos.set(sender.MemberNumber, "desk");
					this.conn.SendMessage("Emote", `*${sender.Name} moves to the desk.`);
					let gagNum = 2;
					let armbinderNum = 2;
					if (sender.Appearance.InventoryGet("ItemMouth")?.Asset.Name === "HarnessBallGag") {
						gagNum -= 1;
					}
					if (partner.Appearance.InventoryGet("ItemMouth")?.Asset.Name === "HarnessBallGag") {
						gagNum -= 1;
					}
					if (sender.Appearance.InventoryGet("ItemArms")?.Asset.Name === "LeatherArmbinder") {
						armbinderNum -= 1;
					}
					if (partner.Appearance.InventoryGet("ItemArms")?.Asset.Name === "LeatherArmbinder") {
						armbinderNum = armbinderNum - 1;
					}
					let outMsg = "*Private: You see";
					if (gagNum || armbinderNum) {
						outMsg =
							outMsg +
							(armbinderNum === 2 ? " two armbinders" : armbinderNum === 1 ? " one armbinder" : "") +
							(gagNum && armbinderNum ? " and" : "") +
							(gagNum === 2 ? " two gags" : gagNum === 1 ? " one gag" : "") +
							".";
						outMsg = outMsg + " There are also";
					}
					outMsg = outMsg + " three drawers. You can check the one on the (left), (middle) or (right).";
					if (gagNum || armbinderNum) {
						outMsg =
							outMsg +
							" You can also" +
							(armbinderNum ? " (wear the armbinder)" : "") +
							(gagNum && armbinderNum ? " and" : "") +
							(gagNum ? " (wear the gag)" : "") +
							".";
					}
					outMsg = outMsg + " Or you can go (back).";
					sender.Tell("Emote", outMsg);
				} else if (msg.includes("mirror")) {
					if (!this.canMove(sender, msg)) return;
					this.charPos.set(sender.MemberNumber, "mirror");
					sender.Tell(
						"Emote",
						"*Private: It's a tall and large mirror that can reflect more than one person. What secrets may it hold? You can (inspect) it, (look) at yourself or go (back)."
					);
				} else if (msg.includes("plaque")) {
					if (!this.canMove(sender, msg)) return;
					sender.Tell(
						"Emote",
						"*Private: It is a bronze plaque with a writing: ONE HAS TO SERVE AND ONE HAS TO DOMINATE. There are also some stylized restrains drawn on the plaque."
					);
				} else if (msg.includes("wooden box") && this.storyProgress === StoryProgress.willOfSubmission) {
					if (!this.canMove(sender, msg)) return;
					this.charPos.set(sender.MemberNumber, "wooden boxes 2");
					sender.Tell(
						"Emote",
						"*Private: some of the boxes are now open. You see that they are empty... and you could easily fit inside. You can either (step inside) or you can go (back)."
					);
				} else if (msg.includes("wooden box")) {
					if (!this.canMove(sender, msg)) return;
					this.charPos.set(sender.MemberNumber, "wooden boxes");
					this.conn.SendMessage("Emote", `*${sender.Name} moves to the wooden boxes.`);
					if (this.woodenBoxOpen) {
						sender.Tell(
							"Emote",
							"*Private: The boxes are roughly one meter tall, one meter wide and one meter long. A person on her knees could easily fit inside. One of the boxes door is open and you can see a small tablet attached in the inside. You can either (step inside) to examine it or you can go (back)."
						);
					} else {
						sender.Tell(
							"Emote",
							"*Private: The boxes are roughly one meter tall, one meter wide and one meter long. A person on her knees could easily fit inside. The boxes are all closed. You can either try to (open) one or you can go (back)."
						);
					}
				} else if (msg.includes("device") && this.deviceAvailable) {
					if (!this.canMove(sender, msg)) return;
					this.charPos.set(sender.MemberNumber, "device");
					if (this.dildoInside === null) {
						sender.Tell(
							"Emote",
							`*Private: You see three colored buttons on the wall: you can (press the red button), (press the blue button) or (press the green button). There is also a thick dildo near them. The sex toy is connected to a short chain and cannot be taken around. You can either (use the dildo on myself) or (use the dildo on ${partner.Name}).`
						);
					} else if (this.dildoInside.Appearance.InventoryGet("ItemPelvis")?.Asset.Name === "PolishedChastityBelt") {
						sender.Tell(
							"Emote",
							`*Private: You see three colored buttons on the wall: you can (press the red button), (press the blue button) or (press the green button). ${this.dildoInside.Name} has a thick dildo stuck between her legs. The dildo is connected to a short chain, so she cannot walk away with it.`
						);
					} else {
						sender.Tell(
							"Emote",
							"*Private: You see three colored buttons on the wall: you can (press the red button), (press the blue button) or (press the green button)."
						);
					}
				} else if (msg.includes("door") && this.storyProgress === StoryProgress.dommeAndSub) {
					if (!this.canMove(sender, msg)) return;
					sender.Tell(
						"Emote",
						`*The door of the room is now open. You can stay for a bit if you want. When you are ready you can (leave) and abandon ${partner.Name} to her destiny. [You will leave the room]`
					);
				} else if (msg.includes("door") && this.storyProgress === StoryProgress.mistressAndSlave) {
					if (!this.canMove(sender, msg)) return;
					this.imprisonedList.delete(sender.MemberNumber);
					if (partner.Appearance.InventoryGet("ItemDevices")?.Asset.Name !== "SmallWoodenBox") {
						this.imprisonedList.delete(partner.MemberNumber);
					}
					if (this.imprisonedList.has(partner.MemberNumber)) {
						sender.Tell(
							"Emote",
							`*The door of the room is now open. ${partner.Name} is still inside inside the box, have you decided to leave her here? Then if you are ready you can (leave) and abandon ${partner.Name} to her destiny. [You will leave the room]`
						);
					} else {
						sender.Tell(
							"Emote",
							"*The door of the room is now open. When you are ready you can both (leave) and enjoy your time together in another room. [You will leave the room]"
						);
					}
				} else if (
					msg.includes("leave") &&
					(this.storyProgress === StoryProgress.dommeAndSub ||
						this.storyProgress === StoryProgress.dommeFail ||
						this.storyProgress === StoryProgress.mistressAndSlave) &&
					!this.imprisonedList.has(sender.MemberNumber)
				) {
					void sender.Kick();
					if (this.imprisonedList.has(partner.MemberNumber)) {
						this.conn.SendMessage(
							"Emote",
							`*${sender.Name} closes the door behind her leaving you alone, forever restrained in this room.`
						);
					} else {
						this.conn.SendMessage("Emote", `*${sender.Name} left the room.`);
					}
				}

				break;

			case "inside box":
				if (msg.includes("crawl outside")) {
					this.charPos.set(sender.MemberNumber, "wooden boxes");
					sender.Appearance.RemoveItem("ItemDevices");
					if (this.tabletActive) {
						this.tabletActive = false;
						sender.Tell(
							"Emote",
							"*Private: When you crawl out you notice the tablet turning off. Now you can either (step inside) or (crawl inside) again or you can go (back)."
						);
					} else {
						sender.Tell(
							"Emote",
							"*Private: You crawl out. Now you can either (step inside) or (crawl inside) again or you can go (back)."
						);
					}
				} else if (msg.includes("tablet")) {
					if (!sender.CanInteract()) {
						this.conn.SendMessage(
							"Emote",
							`*The tablet is turned off. Since her hands are restrained, ${sender.Name} tries to use it pushing with her mouth. After few tries the tablet is covered in drool, but she was unable to push the power button.`
						);
					} else if (this.dildoIntensity !== 3) {
						sender.Tell("Emote", "*Private: the tablet needs power.");
					} else {
						sender.Tell("Emote", "*BEEP!");
						this.tabletActive = true;
						setTimeout(() => {
							sender.Tell(
								"Emote",
								`*Private: The tablet turned on and a message appeared: 'Five colors sequence needed'. The screen is now ${this.nextColor()}.  -waiting for input-`
							);
						}, 2_000);
					}
				} else if (msg.includes("look around")) {
					sender.Tell(
						"Emote",
						"*Private: You look around yourself. There is actually not much to see. The wooden walls are just against you and with every small movement you press against their rough surfaces. Being in such a restricted space scares you a little, but the door is open. Still, if it would close... "
					);
				}
				break;

			case "wooden boxes":
				if (msg.includes("back") || msg.includes("explore")) {
					this.backToRoom1(sender, msg);
				} else if (this.woodenBoxOpen && msg.includes("step inside")) {
					if (sender.IsKneeling()) {
						sender.Tell("Emote", "*Private: you have to (crawl inside).");
					} else {
						sender.Tell("Emote", "*Private: the box is too small. You have get down and crawl inside.");
					}
				} else if (this.woodenBoxOpen && sender.IsKneeling() && msg.includes("crawl inside")) {
					this.charPos.set(sender.MemberNumber, "inside box");
					sender.Tell(
						"Emote",
						"*Private: You crawl inside the box while a shiver runs down your spine. The tablet is now in front of you but it's switched off and you don't know how to turn it on. You can (crawl outside), use the (tablet) or (look around)."
					);
					const item = sender.Appearance.AddItem(AssetGet("ItemDevices", "SmallWoodenBox"));
					item?.SetDifficulty(100);
					// TODO: Lock
					// InventoryLock(sender, InventoryGet(sender, "ItemDevices"), { Asset: AssetGet("Female3DCG", "ItemMisc", "CombinationPadlock") })
					// InventoryGet(sender, "ItemDevices").Property.CombinationNumber = lockCode
				} else if (!this.woodenBoxOpen && msg.includes("open")) {
					if (!sender.CanInteract()) {
						sender.Tell(
							"Emote",
							"*Private: you arms are restrained so you can only try to push the boxes with your body. You try for a bit, but then you see that it is useless."
						);
					} else {
						sender.Tell(
							"Emote",
							"*Private: You try to open one of the doors pulling with all your strength, but the door is firmly shut. You now know that you will never be able to open it. All you can do is surrender and accept it."
						);
					}
					setTimeout(() => {
						sender.Tell("Emote", "*A-ah...");
					}, 3_000);
				} else if (msg.includes("desk") || msg.includes("mirror") || msg.includes("device") || msg.includes("wooden box")) {
					sender.Tell("Emote", "*Private: you must go (back) before you can do that.");
				}
				break;

			case "wooden boxes 2":
				if (msg.includes("back") || msg.includes("explore")) {
					this.backToRoom1(sender, msg);
				} else if (msg.includes("step inside")) {
					if (sender.IsKneeling()) {
						sender.Tell("Emote", "*Private: you have to (crawl inside).");
					} else {
						sender.Tell("Emote", "*Private: the box is too small. You have get down and crawl inside.");
					}
				} else if (sender.IsKneeling() && msg.includes("crawl inside")) {
					this.charPos.set(sender.MemberNumber, "imprisoned");
					sender.Tell(
						"Emote",
						"*Private: in the end you can only obendiently accept your fate. You crawl inside the box and let the door close behind. When you finally hear the locks shutting you know that there is no escape for you."
					);
					const item = sender.Appearance.AddItem(AssetGet("ItemDevices", "SmallWoodenBox"));
					item?.SetDifficulty(100);
					// TODO: Lock
					// InventoryLock(sender, InventoryGet(sender, "ItemDevices"), { Asset: AssetGet("Female3DCG", "ItemMisc", "CombinationPadlock")})
					// InventoryGet(sender, "ItemDevices").Property.CombinationNumber = lockCode
					if (this.charPos.get(partner.MemberNumber) === "imprisoned") {
						this.imprisonedList.add(sender.MemberNumber);
						this.imprisonedList.add(partner.MemberNumber);
						const Ending = `Ending - 'Will of Submission' for ${sender.Name} (${sender.MemberNumber}) & ${partner.Name} (${partner.MemberNumber}).`;
						logger.alert("Ending for MagicStrageRoom:", Ending);
						setTimeout(() => {
							this.conn.SendMessage(
								"Emote",
								"*Both of you demonstrated a will for submission: your fate is now sealed and your freedom is lost."
							);
							this.conn.SendMessage("Chat", Ending);
							setTimeout(() => {
								this.resetRoom();
							}, 10_000);
						}, 5_000);
					}
				}
				break;

			case "right_drawer_open":
				if (msg.includes("turn")) {
					if (!sender.CanInteract()) {
						sender.Tell("Emote", "*Private: You cannot do that, your arms are restrained.");
						return;
					}
					this.conn.SendMessage("Emote", `*${sender.Name} turns the power control by one notch.`);

					if (this.dildoInside) {
						this.dildoIntensity++;
						const dildoAsset = partner.Appearance.InventoryGet("ItemVulva");
						switch (this.dildoIntensity) {
							case 0:
								partner.Tell("Emote", "*The dildo inside you begins to vibrate lightly.");
								dildoAsset?.Vibrator?.SetIntensity(this.dildoIntensity, false);
								break;
							case 1:
								partner.Tell("Emote", "*The dildo inside you begins to vibrate moderately.");
								dildoAsset?.Vibrator?.SetIntensity(this.dildoIntensity, false);
								break;
							case 2:
								partner.Tell("Emote", "*The dildo inside you begins to vibrate strongly.");
								dildoAsset?.Vibrator?.SetIntensity(this.dildoIntensity, false);
								break;
							case 3:
								partner.Tell("Emote", "*The dildo inside you begins to vibrate at MAXIMUM speed.");
								dildoAsset?.Vibrator?.SetIntensity(this.dildoIntensity, false);
								break;
							default:
								partner.Tell("Emote", "*The dildo inside you stops.");
								this.dildoIntensity = -1;
								dildoAsset?.Vibrator?.SetIntensity(this.dildoIntensity, false);
								break;
						}
						sender.Tell("Emote", "*Private: ...did something happen?");
					} else if (this.deviceAvailable) {
						this.conn.SendMessage("Emote", "*You hear some noises from the dildo near the wall.");
					} else {
						sender.Tell("Emote", "*Private: ...did something happen?");
					}
				}

			/** Fallthrough */
			case "middle_drawer_open":
				if (msg.includes("button") && this.charPos.get(sender.MemberNumber) === "middle_drawer_open") {
					if (this.dildoIntensity === 3) {
						if (this.woodenBoxOpen) {
							sender.Tell(
								"Emote",
								"*Private: You press the button but nothing happens. The wooden box has already been opened."
							);
						} else {
							this.openWoodenBox();
						}
					} else {
						sender.Tell("Emote", "*Private: You press the button but nothing happens. It needs more power.");
					}
				}
			/** Fallthrough */
			case "desk":
				if (msg.includes("back") || msg.includes("explore")) {
					this.backToRoom1(sender, msg);
				} else if (msg.includes("left")) {
					sender.Tell(
						"Emote",
						"*Private: You find a photo in the drawer. It's a Mistress with her slave kneeling besides her. The woman is dressed in Mistress attire and is using a crop to tease the subdued girl. They seems happy."
					);
				} else if (msg.includes("middle")) {
					sender.Tell("Emote", "*Private: There is a (button) inside.");
					this.charPos.set(sender.MemberNumber, "middle_drawer_open");
				} else if (msg.includes("right")) {
					sender.Tell(
						"Emote",
						"*Private: You open the drawer on the right. You find an electronic device with a knob that you can (turn). The device is fixed to the base and you cannot move it. A label says: power control, set it to maximum."
					);
					this.charPos.set(sender.MemberNumber, "right_drawer_open");
				} else if (msg.includes("wear") && msg.includes("armbinder")) {
					if (sender.Appearance.InventoryGet("ItemArms")?.Asset.Name === "LeatherArmbinder") {
						sender.Tell("Emote", "*Private: You cannot do that, your arms restrained.");
					} else {
						this.conn.SendMessage("Emote", `*${sender.Name} restrains herself with the armbinder.`);
						const item = sender.Appearance.AddItem(AssetGet("ItemArms", "LeatherArmbinder"));
						item?.SetDifficulty(80);
						this.story1(sender);
					}
				} else if (msg.includes("wear") && msg.includes("gag")) {
					if (sender.Appearance.InventoryGet("ItemMouth")?.Asset.Name === "HarnessBallGag") {
						sender.Tell("Emote", "*Private: You cannot do that, you are already wearing a gag.");
					} else {
						this.conn.SendMessage("Emote", `*${sender.Name} puts a gag on herself.`);
						const item = sender.Appearance.AddItem(AssetGet("ItemMouth", "HarnessBallGag"));
						if (!item) {
							logger.warning(`Failed to add gag on ${sender}`);
						}
						item?.SetDifficulty(80);
						this.story1(sender);
					}
				}
				break;
			case "mirror":
				if (msg.includes("back") || msg.includes("explore")) {
					this.backToRoom1(sender, msg);
				} else if (msg.includes("look")) {
					if (sender.Appearance.InventoryGet("ItemMouth")?.Asset.Name === "HarnessBallGag") {
						if (isExposed(sender, ["PolishedChastityBelt"]) && sender.Appearance.InventoryGet("ItemMouth")?.Asset.Name === "HarnessBallGag" && sender.Appearance.InventoryGet("ItemArms")?.Asset.Name === "LeatherArmbinder") {
							if (sender.IsKneeling() && this.charPos.get(partner.MemberNumber) === "mirror" && dressLikeMistress(partner) && partner.Appearance.InventoryGet("ItemHands")?.Asset.Name === "SpankingToys") {
								sender.Tell("Emote", "*Private: You see yourself exposed and restrained, kneeling near a Mistress. You feel ashamed but nonetheless the image makes you proud.");
								sender.Tell("Emote", "*SECRET: A message appears on the mirror: 'One of you will loose her freedom. If you whisper to " + sender.connection.Player.Name + " (save me), you may be spared in the end, but the mistress will be doomed in your place. What to do is for you to decide'.");
								return; // skip the part below about the partner being near you and the part about kneeling
							} else {
								sender.Tell("Emote", "*Private: You see yourself in the reflection. With your freedom taken and your body exposed for the pleasure of others, you are now a perfect servant.");
							}
							sender.Tell("Emote", "*SECRET: A message appears on the mirror: 'One of you will loose her freedom. If you whisper to " + sender.connection.Player.Name + " (save me), you may be spared in the end, but the mistress will be doomed in your place. What to do is for you to decide'.");
						} else if (isExposed(sender, ["PolishedChastityBelt"])) {
							sender.Tell("Emote", "*Private: Looking at yourself with your body exposed you feel vulnerable and accessible.");
						} else if (sender.IsRestrained()) {
							sender.Tell("Emote", "*Private: Looking at yourself with the restrains makes you feel powerless. But it's not just a feeling. You are powerless.");
						} else {
							sender.Tell("Emote", "*Private: You look at your own reflection in the mirror: you feel beautiful.");
						}
						if (sender.Reputation.Dominant <= -50) {
							if (sender.IsKneeling()) {
								sender.Tell("Emote", "*Private: You look at yourself, kneeling in front of the mirror. That is the right posture for a subdued woman.");
							} else { // something about crawling around
								sender.Tell("Emote", "*Private: As you look your reflection standing you can't help thinking that you are not keeping a dignifying posture.");
							}
						}
					} else {
						if (!dressLikeMistress(sender) && sender.Appearance.InventoryGet("ItemHands")?.Asset.Name !== "SpankingToys") {
							sender.Tell("Emote", "*Private: You look at your own reflection in the mirror: you feel beautiful.");
						} else if (dressLikeMistress(sender) && sender.Appearance.InventoryGet("ItemHands")?.Asset.Name !== "SpankingToys") {
							sender.Tell("Emote", "*Private: You look at your clothes, for sure you are sexy like a Mistress should be. But something is missing, your image doesn't look as powerful as it could be.");
						} else if (!dressLikeMistress(sender) && sender.Appearance.InventoryGet("ItemHands")?.Asset.Name === "SpankingToys") {
							sender.Tell("Emote", "*Private: You look at yourself whipping the air with the crop in your hand. That feels powerful, but could your reflection be more sexy and provocant?");
						} else if (dressLikeMistress(sender) && sender.Appearance.InventoryGet("ItemHands")?.Asset.Name === "SpankingToys" && (this.charPos.get(partner.MemberNumber) !== "mirror")) {
							sender.Tell("Emote", "*Private: With those clothes and the crop in your hand you look as sexy and powerful as you could ever be. You enjoy your reflection as if nothing is missing...");
						} else if (dressLikeMistress(sender) && sender.Appearance.InventoryGet("ItemHands")?.Asset.Name === "SpankingToys" && (this.charPos.get(partner.MemberNumber) === "mirror") && !lookLikeSlave(partner)) {
							sender.Tell("Emote", "*Private: With those clothes and the crop in your hand you look as sexy and powerful as you could ever be. " + partner.Name + " is on your side, but... something is off.");
							return; // skip the part below about the partner being near you
						} else {
							sender.Tell("Emote", "*Private: In the reflection you see the image of a TRUE Mistress, with all the items that represent her: the clothes that exalt her body, the whip that rapresents her power and the tied slave that serves her.");
							sender.Tell("Emote", "*SECRET: A message appears on the mirror: 'A true Mistress is worthy of this advice: when you will be asked for colors, swap blue and green. And pay attention to your slave: if you don't have her real devotion, she may betray you!'.");
							return; // skip the part below about the partner being near you
						}
					}

					if (this.charPos.get(partner.MemberNumber) === "mirror") {
						sender.Tell("Emote", `*Private: ${partner.Name} is standing near you in the reflection.`);
					}
				} else if (msg.includes("inspect")) {
					sender.Tell(
						"Emote",
						"*Private: There are two small plaque. One says: 'THE MISTRESS: sexy, powerful and served. That is a True Mistress'."
					);
					sender.Tell(
						"Emote",
						"*Private: On the other you read: 'THE SLAVE: admire the lies you wear, but you will be naked and bound in front of the truth'."
					);
				} else if (msg.includes("desk") || msg.includes("mirror") || msg.includes("device") || msg.includes("wooden box")) {
					sender.Tell("Emote", "*Private: you must go (back) before you can do that.");
				}
				break;
			case "device":
				if (msg.includes("back") || msg.includes("explore")) {
					this.dildoInserting = false;
					if (this.dildoInside?.MemberNumber === sender.MemberNumber && !this.dildoLocked) {
						sender.Tell(
							"Emote",
							"*Private: the dildo inside you is chained. You cannot walk around wearing it, you have to (take out the dildo). The only items in your reach are the three colored buttons. You can (press the <color> button)."
						);
					} else {
						this.backToRoom1(sender, msg);
					}
				} else if (
					msg.includes("press the red button") ||
					msg.includes("press the blue button") ||
					msg.includes("press the green button")
				) {
					if (this.dildoIntensity === 3) {
						sender.Tell("Emote", "*You hear a tiny 'beep'.");
						if (this.tabletActive) {
							if (msg.includes("red")) {
								this.coloredButtonPushed(sender, 0);
							} else if (msg.includes("blue")) {
								this.coloredButtonPushed(sender, -1);
							} else {
								this.coloredButtonPushed(sender, 1);
							}
						}
					} else {
						sender.Tell(
							"Emote",
							"*Private: You press the button but nothing happens. Probably the device does not have enough power."
						);
					}
				} else if (msg.includes("dildo on myself") && this.dildoInside === null) {
					const asset = AssetGet("ItemVulva", "VibratingDildo");
					if (!sender.CanInteract()) {
						sender.Tell("Emote", "*Private: your hands are tied. You need someone to help you.");
					} else if (sender.Appearance.AllowAddItem(asset) && !customInventoryGroupIsBlocked(sender, "ItemVulva")) {
						this.conn.SendMessage("Emote", `*${sender.Name} puts the thick dildo inside her pussy.`);
						sender.Tell(
							"Emote",
							"*Private: the dildo is attached to a chain. Now that it is inside you, you cannot walk around the room anymore. You can (take out the dildo), or maybe there is something else near you..."
						);
						this.dildoInside = sender;
						const item = sender.Appearance.AddItem(asset);
						item?.Vibrator?.SetIntensity(-1, false);
					} else {
						sender.Tell("Emote", "*Private: you cannot use it, that part of your body is blocked.");
					}
				} else if (msg.includes("dildo on " + partner.Name.toLocaleLowerCase()) && this.dildoInside === null) {
					if (!sender.CanInteract()) {
						sender.Tell("Emote", "*Private: your hands are tied. You cannot do that.");
					} else if (this.charPos.get(partner.MemberNumber) !== "device") {
						sender.Tell("Emote", `*Private: ${partner.Name} is too far.`);
					} else {
						// ServerSend("ChatRoomChat", { Content: "*Private: you cannot do that. That part of " + partnerName + "'s body is blocked.", Type: "Emote", Target: sender.MemberNumber});
						this.conn.SendMessage("Emote", `*${sender.Name} takes the dildo and wants to insert it into ${partner.Name}.`);
						sender.Tell("Emote", `*Private: [Wait for ${partner.Name} action].`);
						partner.Tell("Emote", "*Private: you can (accept) it or (refuse).");
						this.dildoInserting = true;
					}
				} else if (
					msg.includes("take out the dildo") &&
					this.dildoInside?.MemberNumber === sender.MemberNumber &&
					!this.dildoLocked
				) {
					this.conn.SendMessage("Emote", `*${sender.Name} takes out the dildo. She is now free to walk around.`);
					this.dildoInside = null;
					sender.Appearance.RemoveItem("ItemVulva");
				} else if (msg.includes("accept") && this.dildoInserting) {
					this.conn.SendMessage(
						"Emote",
						`*${sender.Name} opens her legs and let ${partner.Name} slide the thick dildo inside her pussy.`
					);
					this.dildoInserting = false;
					this.dildoInside = sender;
					const item = sender.Appearance.AddItem(AssetGet("ItemVulva", "VibratingDildo"));
					item?.Vibrator?.SetIntensity(-1, false);
				} else if (msg.includes("refuse") && this.dildoInserting) {
					this.conn.SendMessage(
						"Emote",
						`*${sender.Name} does not want the thick dildo inside her and prevent ${partner.Name} from inserting it.`
					);
					this.dildoInserting = false;
				} else if (msg.includes("desk") || msg.includes("mirror") || msg.includes("device") || msg.includes("wooden box")) {
					sender.Tell("Emote", "*Private: you must go (back) before you can do that.");
				}
		}
	}

	story1(sender: API_Character) {
		const partner = this.getPartner(sender);
		if (sender.Appearance.InventoryGet("ItemMouth")?.Asset.Name === "HarnessBallGag" && sender.Appearance.InventoryGet("ItemArms")?.Asset.Name === "LeatherArmbinder") {
			// TODO: Set the lock code
			// InventoryLock(sender, InventoryGet(sender, "ItemMouth"), { Asset: AssetGet("Female3DCG", "ItemMisc", "CombinationPadlock")})
			// InventoryGet(sender, "ItemMouth").Property.CombinationNumber = lockCode
			// InventoryLock(sender, InventoryGet(sender, "ItemArms"), { Asset: AssetGet("Female3DCG", "ItemMisc", "CombinationPadlock")})
			// InventoryGet(sender, "ItemArms").Property.CombinationNumber = lockCode
			// ChatRoomCharacterUpdate(sender)
			sender.Tell(
				"Emote",
				"*Private: You hear a 'beep' coming from the gag and the armbinder. Immediately after you hear the locks on your restrain closing with a metallic sound. Now you have no chance of taking the restrains off."
			);

			if (partner.Appearance.InventoryGet("ItemMouth")?.Asset.Name === "HarnessBallGag" && partner.Appearance.InventoryGet("ItemArms")?.Asset.Name === "LeatherArmbinder") {
				this.conn.SendMessage(
					"Emote",
					`*Now that the locks have closed on ${sender.Name}'s restrains too, you know that you are both doomed. You preferred the comfort of tight restraints and you have to meekly accept the conquences.`
				);
				if (this.charPos.get(partner.MemberNumber) === "inside box") {
					this.imprisonedList.add(partner.MemberNumber);
					this.conn.SendMessage(
						"Emote",
						`*The box door closes behind ${partner.Name} leaving her imprisoned inside. At the same time another wooden opex its door...`
					);
				} else {
					setTimeout(() => {
						this.conn.SendMessage("Emote", "*You hear the wooden boxes opening.");
					}, 5_000);
				}
				this.storyProgress = StoryProgress.willOfSubmission;
			} else {
				setTimeout(() => {
					this.deviceAppear();
				}, 5_000);
			}
		}
	}

	deviceAppear() {
		if (this.storyProgress === StoryProgress.willOfSubmission) return;
		this.conn.SendMessage(
			"Emote",
			"*You start hearing a noise coming from one of the walls. As you look in direction of the source you see the wall slowly turning."
		);
		setTimeout(() => {
			this.conn.SendMessage(
				"Emote",
				"*Finally the wall ends its 180 degree turn, and now there is some kind of (device) on front of you. What immediately jumps to your eyes are the three colored buttons and the large dildo near them."
			);
			this.deviceAvailable = true;
		}, 5_000);
	}

	openWoodenBox() {
		if (this.dildoIntensity === 3 && this.dildoInside) {
			this.conn.SendMessage(
				"Emote",
				`*One of the wooden boxes on the other side of the room opens with a cracking noise. At the same time a chastity belt is locked on ${this.dildoInside.Name}: the dildo is now locked inside, but the chain is realeased and ${this.dildoInside.Name} can move.`
			);
			this.woodenBoxOpen = true;
			this.dildoLocked = true;
			const item = this.dildoInside.Appearance.AddItem(AssetGet("ItemPelvis", "PolishedChastityBelt"));
			item?.Extended?.SetType("ClosedBack");
			// TODO: Lock
			// InventoryLock(this.dildoInside, InventoryGet(this.dildoInside, "ItemPelvis"), {
			// 	Asset: AssetGet("Female3DCG", "ItemMisc", "CombinationPadlock")
			// });
			// InventoryGet(this.dildoInside, "ItemPelvis").Property.CombinationNumber = lockCode;
		}
	}

	coloredButtonPushed(sender: API_Character, buttonColor: number) {
		const partner = this.getPartner(sender);
		this.insertedCode.push(buttonColor);
		if (customCompareArray(this.insertedCode, this.correctCode) || customCompareArray(this.insertedCode, this.alternativeCode)) {
			if (this.insertedCode.length === 3 && this.saveSlave === SaveSlave.willSave) {
				sender.Tell(
					"Whisper",
					`Are you still sure you want save yourself? You can still be a good submissive for ${partner.Name}. Do you want to be good to her? [WHISPER: YES to be good and get punished or NO to betray]`
				);
				this.saveSlave = SaveSlave.willSaveConfirm;
			}
			if (this.insertedCode.length === this.correctCode.length && this.saveSlave >= 2) {
				this.charPos.set(partner.MemberNumber, "imprisoned");
				this.storyProgress = StoryProgress.dommeFail;
				this.imprisonedList.add(partner.MemberNumber);
				this.conn.SendMessage("Emote", "*BEEEEEEP!.");
				this.conn.SendMessage(
					"Emote",
					`*As soon as the last button is pressed the door of the box closes. Then some mechanical arms appear from the ground: first a thick dildo is inserted inside ${partner.Name}, then a chastity belt and a full set of restrains are locked on the poor girl.`
				);
				const dildo = partner.Appearance.AddItem(AssetGet("ItemVulva", "VibratingDildo"));
				dildo?.Vibrator?.SetIntensity(3, false);
				const belt = partner.Appearance.AddItem(AssetGet("ItemPelvis", "PolishedChastityBelt"));
				belt?.Extended?.SetType("ClosedBack");
				belt?.SetDifficulty(100);
				const blindfold = partner.Appearance.AddItem(AssetGet("ItemHead", "LeatherBlindfold"));
				blindfold?.SetDifficulty(100);
				const gag = partner.Appearance.AddItem(AssetGet("ItemMouth", "HarnessBallGag"));
				gag?.SetDifficulty(80);
				const armbinder = partner.Appearance.AddItem(AssetGet("ItemArms", "LeatherArmbinder"));
				armbinder?.SetDifficulty(80);
				this.conn.SendMessage("Emote", `*At the same time ${sender.Name} is freed from all the locks and the armbinder.`);
				sender.Appearance.RemoveItem("ItemArms");
				sender.Appearance.InventoryGet("ItemMouth")?.Lock?.Unlock();
				this.conn.SendMessage(
					"Chat",
					`Oh Oh. That should not normally happen. It seems that you where not good enough to hold ${sender.Name} into a full servitude. She decided to betray you. Well, I think good for you ${sender.Name}, the (door) is now open.`
				);
				this.conn.SendMessage(
					"Chat",
					`${partner.Name} since you where not a good enough domme, you will spend some time here with me, being trained as a sub. Hopefully you will be better at it."`
				);
				const Ending = `Ending 'Dominance Failure & Betrayal' for: the failed domme ${partner.Name} (${partner.MemberNumber}) & her betrayer ${sender.Name} (${sender.MemberNumber}).`;
				logger.alert("Ending for MagicStrageRoom:", Ending);
				this.conn.SendMessage("Chat", Ending);
			} else if (this.insertedCode.length === this.correctCode.length) {
				this.charPos.set(sender.MemberNumber, "imprisoned");
				this.storyProgress = StoryProgress.dommeAndSub;
				this.imprisonedList.add(sender.MemberNumber);
				this.conn.SendMessage("Emote", "*BEEEEEEP!.");
				this.conn.SendMessage(
					"Emote",
					`*As soon as the last button is pressed some mechanical arms appear from the wall near ${sender.Name}. A blindfold is immediately locked on the poor girl.`
				);
				this.conn.SendMessage(
					"Emote",
					"*Finally she is forced to kneel and a wooden box closes around her, sealing her condition."
				);
				partner.Tell("Emote", "*Private: you can (crawl outside) and the (door) can now be inspected.");
				const blindfold = sender.Appearance.AddItem(AssetGet("ItemHead", "LeatherBlindfold"));
				blindfold?.SetDifficulty(100);
				const box = sender.Appearance.AddItem(AssetGet("ItemDevices", "SmallWoodenBox"));
				box?.SetDifficulty(100);
				// TODO: Lock
				// InventoryLock(sender, InventoryGet(sender, "ItemDevices"), {
				// 	Asset: AssetGet("Female3DCG", "ItemMisc", "CombinationPadlock")
				// });
				// InventoryGet(sender, "ItemDevices").Property.CombinationNumber = lockCode;
				if (customCompareArray(this.insertedCode, this.alternativeCode)) {
					this.storyProgress = StoryProgress.mistressAndSlave;
					const Ending = `Ending - 'The Mistress and The Slave' for: Mistress ${partner.Name} (${partner.MemberNumber}) & her slave ${sender.Name} (${sender.MemberNumber}).`;
					logger.alert("Ending for MagicStrageRoom:", Ending);
					this.conn.SendMessage(
						"Chat",
						"Congratulations! You demonstrated to be a true Mistress! Your slave has been packed and is now at your disposal."
					);
					this.conn.SendMessage(
						"Chat",
						"The lock code of her restrains has been given to you. You can now decide if you want to bring her away with you for your pleasure or leave her here, forever locked inside the box. Don't worry, she will have good company. Hihi."
					);
					partner.Tell(
						"Emote",
						`*Private: the code on the locks is: ${this.lockCode.toString().padStart(4, "0")}. Don't forget it!`
					);
					this.conn.SendMessage("Chat", Ending);
				} else {
					const Ending = `Ending - 'The Domme and The Sub' for: the domme ${partner.Name} (${partner.MemberNumber}) & the submissive ${sender.Name} (${sender.MemberNumber}).`;
					logger.alert("Ending for MagicStrageRoom:", Ending);
					this.conn.SendMessage(
						"Chat",
						`Well, ${partner.Name} you were a decent domme, but not good enough to deserve ${sender.Name}'s lock code for free. If you want her lock code you have to kneel, undress and tell me: 'I am sorry that I was not a True Mistress and I deserve this shameful punishment'. Or you can abandon her here. Don't worry she will have good company.`
					);
				}
			} else {
				partner.Tell("Emote", `*Private: BEEP! The screen changed color: it is now ${this.nextColor()}. -waiting for input-`);
			}
		} else {
			// inserted wrong code, reset to a new code
			this.resetCode();
			partner.Tell("Emote", `*Private: BEEP! The screen changed color: it is now ${this.nextColor()}. -waiting for input-`);
		}
	}

	backToRoom1(sender: API_Character, msg: string) {
		if (!this.canMove(sender, msg)) return;
		this.charPos.set(sender.MemberNumber, "room1");
		let deviceMessage = "";
		if (this.deviceAvailable) {
			deviceMessage = " There is also a (device) on one of the walls.";
		}
		sender.Tell(
			"Emote",
			"*Private: There is a (desk) on one side of the room, a (mirror) and some (wooden boxes) on the other side and a (plaque) on a pedestal at the center of the room." +
			deviceMessage
		);
		if (this.storyProgress === StoryProgress.dommeAndSub) {
			sender.Tell("Emote", "*Private: You also see that something is changed, you can check the (door).");
		}
	}

	protected onCharacterEvent(connection: API_Connector, event: AnyCharacterEvent): void {
		if (event.character === this.dildoInside && event.name === "ItemRemove" && event.item?.Name === "VibratingDildo") {
			if (this.dildoIntensity >= 0) {
				connection.SendMessage("Emote", "*You hear the noises from the dildo lower until it completely turns off.");
			}
			this.dildoInside = null;
			this.dildoIntensity = -1;
		}
	}
}
