export * from "@midnightntwrk/ledger-v9";
/** Resolves once the ledger's wasm is instantiated; await it before importing anything that touches the ledger. */
export const ready: Promise<void>;
