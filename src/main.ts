// The entry: the main menu first (who you are, Practice or Live), then the room.
import { showMenu } from "./ui/menu.ts";
import { isLocalSite } from "./live/wallet.ts";

// ?wallet=<url>: a seed wallet served by local/bridge.ts stands in for Lace on the undeployed network.
const bridge = new URLSearchParams(location.search).get("wallet");
if (bridge && isLocalSite(location.hostname)) (await import("./live/bridge-wallet.ts")).installBridge(bridge);

const entry = await showMenu();
const { enterRoom } = await import("./room.ts");
await enterRoom(entry);
