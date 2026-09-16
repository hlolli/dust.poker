// The entry: the main menu first (who you are, Practice or Live), then the room.
import { enterRoom } from "./room.ts";
import { showMenu } from "./ui/menu.ts";

const { profile } = await showMenu();
await enterRoom(profile);
