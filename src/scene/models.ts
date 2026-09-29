import bartender from "../assets/characters/bartender.glb";
import dealer from "../assets/characters/dealer.glb";
import dean from "../assets/characters/dean.glb";
import ella from "../assets/characters/ella.glb";
import frank from "../assets/characters/frank.glb";
import grace from "../assets/characters/grace.glb";
import louis from "../assets/characters/louis.glb";
import peggy from "../assets/characters/peggy.glb";
import sammy from "../assets/characters/sammy.glb";
import tony from "../assets/characters/tony.glb";

/**
 * The characters a player may be: our own, made with MakeHuman by scripts/make-character.py
 * (CC0, see LICENSES.md), a 1960s Las Vegas card room's regulars. A profile picks one by index.
 */
export const MODELS: { label: string; url: string }[] = [
  { label: "Man in a dinner jacket", url: frank },
  { label: "Woman in a halter dress", url: peggy },
  { label: "Man in a grey suit", url: dean },
  { label: "Woman in a shift dress", url: ella },
  { label: "Man in a suit and tie", url: sammy },
  { label: "Woman in a full-skirted dress", url: grace },
  { label: "Man in a double-breasted suit", url: louis },
  { label: "Man in a three-piece suit", url: tony },
];

/** The house staff (the dealer's waistcoat is recoloured in scene/dealer.ts). */
export const STAFF = { dealer, bartender };
