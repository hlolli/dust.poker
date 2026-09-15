export * from "@midnightntwrk/onchain-runtime-v4";
/** Resolves once the on-chain runtime's wasm is instantiated; await it before importing the referee. */
export const ready: Promise<void>;
