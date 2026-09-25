// The entry: the main menu first (who you are, Practice or Live), then the room.
import { enterRoom } from "./room.ts";
import { showMenu } from "./ui/menu.ts";

// ?wallet=<url>: a seed wallet served by local/bridge.ts stands in for Lace on the undeployed network.
const bridge = new URLSearchParams(location.search).get("wallet");
if (bridge) (await import("./live/bridge-wallet.ts")).installBridge(bridge);

await enterRoom(await showMenu());
