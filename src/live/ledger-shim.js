// Replaces @midnightntwrk/ledger-v9's browser entry, which imports its wasm as an ES module,
// the same way src/compact/onchain-runtime-shim.js does for the on-chain runtime: Bun gives us
// the wasm as a URL, we instantiate it by hand with the modules it imports (the bindings and
// wasm-bindgen's inline snippets), and callers `await ready` before touching the ledger.
// scripts/wasm-plugin.ts points the bare specifier here.
import wasmUrl from "../../node_modules/@midnightntwrk/ledger-v9/midnight_ledger_wasm_v9_bg.wasm";
import * as bg from "../../node_modules/@midnightntwrk/ledger-v9/midnight_ledger_wasm_v9_bg.js";
import * as s0 from "../../node_modules/@midnightntwrk/ledger-v9/snippets/midnight-ledger-wasm-v9-672bf845dbca816d/inline0.js";
import * as s1 from "../../node_modules/@midnightntwrk/ledger-v9/snippets/midnight-ledger-wasm-v9-672bf845dbca816d/inline1.js";
import * as s2 from "../../node_modules/@midnightntwrk/ledger-v9/snippets/midnight-ledger-wasm-v9-672bf845dbca816d/inline2.js";
import * as s3 from "../../node_modules/@midnightntwrk/ledger-v9/snippets/midnight-ledger-wasm-v9-672bf845dbca816d/inline3.js";
import * as s4 from "../../node_modules/@midnightntwrk/ledger-v9/snippets/midnight-ledger-wasm-v9-672bf845dbca816d/inline4.js";
import * as s5 from "../../node_modules/@midnightntwrk/ledger-v9/snippets/midnight-ledger-wasm-v9-672bf845dbca816d/inline5.js";
import * as s6 from "../../node_modules/@midnightntwrk/ledger-v9/snippets/midnight-ledger-wasm-v9-672bf845dbca816d/inline6.js";
import * as s7 from "../../node_modules/@midnightntwrk/ledger-v9/snippets/midnight-ledger-wasm-v9-672bf845dbca816d/inline7.js";
import * as s8 from "../../node_modules/@midnightntwrk/ledger-v9/snippets/midnight-ledger-wasm-v9-672bf845dbca816d/inline8.js";
import * as s9 from "../../node_modules/@midnightntwrk/ledger-v9/snippets/midnight-ledger-wasm-v9-672bf845dbca816d/inline9.js";
import * as s10 from "../../node_modules/@midnightntwrk/ledger-v9/snippets/midnight-ledger-wasm-v9-672bf845dbca816d/inline10.js";
import * as s11 from "../../node_modules/@midnightntwrk/ledger-v9/snippets/midnight-ledger-wasm-v9-672bf845dbca816d/inline11.js";
import * as s12 from "../../node_modules/@midnightntwrk/ledger-v9/snippets/midnight-ledger-wasm-v9-672bf845dbca816d/inline12.js";
import * as s13 from "../../node_modules/@midnightntwrk/ledger-v9/snippets/midnight-ledger-wasm-v9-672bf845dbca816d/inline13.js";
import * as s14 from "../../node_modules/@midnightntwrk/ledger-v9/snippets/midnight-ledger-wasm-v9-672bf845dbca816d/inline14.js";
import * as s15 from "../../node_modules/@midnightntwrk/ledger-v9/snippets/midnight-ledger-wasm-v9-672bf845dbca816d/inline15.js";
import * as s16 from "../../node_modules/@midnightntwrk/ledger-v9/snippets/midnight-ledger-wasm-v9-672bf845dbca816d/inline16.js";
import * as s17 from "../../node_modules/@midnightntwrk/ledger-v9/snippets/midnight-ledger-wasm-v9-672bf845dbca816d/inline17.js";
import * as s18 from "../../node_modules/@midnightntwrk/ledger-v9/snippets/midnight-ledger-wasm-v9-672bf845dbca816d/inline18.js";
import * as s19 from "../../node_modules/@midnightntwrk/ledger-v9/snippets/midnight-ledger-wasm-v9-672bf845dbca816d/inline19.js";
import * as s20 from "../../node_modules/@midnightntwrk/ledger-v9/snippets/midnight-ledger-wasm-v9-672bf845dbca816d/inline20.js";
import * as s21 from "../../node_modules/@midnightntwrk/ledger-v9/snippets/midnight-ledger-wasm-v9-672bf845dbca816d/inline21.js";
import * as s22 from "../../node_modules/@midnightntwrk/ledger-v9/snippets/midnight-ledger-wasm-v9-672bf845dbca816d/inline22.js";
import * as s23 from "../../node_modules/@midnightntwrk/ledger-v9/snippets/midnight-ledger-wasm-v9-672bf845dbca816d/inline23.js";
import * as s24 from "../../node_modules/@midnightntwrk/ledger-v9/snippets/midnight-ledger-wasm-v9-672bf845dbca816d/inline24.js";
import * as s25 from "../../node_modules/@midnightntwrk/ledger-v9/snippets/midnight-ledger-wasm-v9-672bf845dbca816d/inline25.js";
import * as s26 from "../../node_modules/@midnightntwrk/ledger-v9/snippets/midnight-ledger-wasm-v9-672bf845dbca816d/inline26.js";
export * from "../../node_modules/@midnightntwrk/ledger-v9/midnight_ledger_wasm_v9_bg.js";

const snippets = [s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14, s15, s16, s17, s18, s19, s20, s21, s22, s23, s24, s25, s26];
const imports = { "./midnight_ledger_wasm_v9_bg.js": bg };
snippets.forEach((s, i) => (imports[`./snippets/midnight-ledger-wasm-v9-672bf845dbca816d/inline${i}.js`] = s));

export const ready = WebAssembly.instantiateStreaming(fetch(wasmUrl), imports).then(({ instance }) => {
  bg.__wbg_set_wasm(instance.exports);
  instance.exports.__wbindgen_start();
});
