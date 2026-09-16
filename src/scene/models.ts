import businessFemale02 from "../assets/avatars/Business_Female_02.glb";
import businessMale01 from "../assets/avatars/Business_Male_01.glb";
import businessMale02 from "../assets/avatars/Business_Male_02.glb";
import businessMale04 from "../assets/avatars/Business_Male_04.glb";
import businessMale06 from "../assets/avatars/Business_Male_06.glb";
import femaleParty01 from "../assets/avatars/Female_Party_01.glb";
import femaleParty02 from "../assets/avatars/Female_Party_02.glb";

/** The characters a player may be (Rocketbox, see LICENSES.md). A profile picks one by index. */
export const MODELS: { label: string; url: string }[] = [
  { label: "Man in a dark suit", url: businessMale01 },
  { label: "Woman in a grey dress", url: businessFemale02 },
  { label: "Man in a waistcoat", url: businessMale04 },
  { label: "Woman in a white party dress", url: femaleParty01 },
  { label: "Man in a brown suit", url: businessMale06 },
  { label: "Woman in a red party dress", url: femaleParty02 },
  { label: "Man in a navy suit", url: businessMale02 },
];

/** The house staff wear this one (the dealer is redressed in scene/dealer.ts). */
export const STAFF_MODEL = businessMale02;
