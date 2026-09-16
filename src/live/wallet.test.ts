import { describe, expect, test } from "bun:test";
import { decodeAddress } from "./wallet.ts";

// Vectors made with the bech32 reference library (bitcoinjs/bech32 2.0.0), the same encoding
// @midnightntwrk/wallet-sdk-address-format produces: hrp mn_addr_<network>, 32 bytes, no length limit.
const bytes = "0b30557a9fc4e90e33587da2c7ec11365b80a5caef14395e83a8cdf2173c6186";
const preview = "mn_addr_preview1pvc9275lcn5suv6c0k3v0mq3xedcpfw2au2rjh5r4rxly9euvxrq6nhvej";
const mainnet = "mn_addr1pvc9275lcn5suv6c0k3v0mq3xedcpfw2au2rjh5r4rxly9euvxrqpxawfc";
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

describe("decodeAddress", () => {
  test("an unshielded address on a named network", () => {
    const a = decodeAddress(preview);
    expect(a.kind).toBe("addr");
    expect(a.network).toBe("preview");
    expect(hex(a.bytes)).toBe(bytes);
  });
  test("mainnet addresses carry no network segment", () => {
    const a = decodeAddress(mainnet);
    expect(a.network).toBe("mainnet");
    expect(hex(a.bytes)).toBe(bytes);
  });
  test("upper case is the same address", () => {
    expect(hex(decodeAddress(preview.toUpperCase()).bytes)).toBe(bytes);
  });
  test("a changed character fails the checksum", () => {
    expect(() => decodeAddress(preview.replace("pvc9", "pvc8"))).toThrow(/checksum/);
    expect(() => decodeAddress(preview.slice(0, -1) + "k")).toThrow(/checksum/);
  });
  test("other prefixes are not Midnight addresses", () => {
    expect(() => decodeAddress("bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0")).toThrow(/not a Midnight/);
    expect(() => decodeAddress("mn_addr1Pvc9275lcn5suv6c0k3v0mq3xedcpfw2au2rjh5r4rxly9euvxrqpxawfc")).toThrow(/mixed-case/);
  });
});
