import { describe, expect, it } from "vitest";
import {
  MAX_WALLET_FLAGS,
  getWalletFlag,
  nextWalletFlag,
  normalizeWalletFlag,
  normalizeWalletFlags,
  setWalletFlag,
} from "./walletFlags";

const ADDRESS = "0x8fc6e1d2f21bb22b1013d05ecf1f06fd73cdcb34";
const ADDRESS_UPPER = `0x${ADDRESS.slice(2).toUpperCase()}`;

describe("normalizeWalletFlag", () => {
  it("accepts only the fixed local flag enum", () => {
    expect(normalizeWalletFlag("trusted")).toBe("trusted");
    expect(normalizeWalletFlag("watch")).toBe("watch");
    expect(normalizeWalletFlag("blocked")).toBe("blocked");
    expect(normalizeWalletFlag("__proto__")).toBe("");
  });
});

describe("normalizeWalletFlags", () => {
  it("keeps valid flags keyed by lower-case checksum address", () => {
    expect(
      normalizeWalletFlags({
        [ADDRESS_UPPER]: "watch",
        "0xdead": "blocked",
        [ADDRESS]: "bad",
      }),
    ).toEqual({
      [ADDRESS]: "watch",
    });
  });

  it("rejects inherited records and caps flag count", () => {
    const inherited = Object.create({ [ADDRESS]: "blocked" });
    expect(normalizeWalletFlags(inherited)).toEqual({});

    const flags = Object.fromEntries(
      Array.from({ length: MAX_WALLET_FLAGS + 1 }, (_, index) => [
        `0x${(index + 1).toString(16).padStart(40, "0")}`,
        "trusted",
      ]),
    );
    expect(Object.keys(normalizeWalletFlags(flags))).toHaveLength(
      MAX_WALLET_FLAGS,
    );
  });
});

describe("setWalletFlag", () => {
  it("sets, reads, clears, and does not mutate input flags", () => {
    const flags = {};
    const withFlag = setWalletFlag(flags, ADDRESS_UPPER, "blocked");

    expect(flags).toEqual({});
    expect(getWalletFlag(withFlag, ADDRESS)).toBe("blocked");
    expect(setWalletFlag(withFlag, ADDRESS, "")).toEqual({});
  });
});

describe("nextWalletFlag", () => {
  it("cycles through flags and back to empty", () => {
    expect([
      nextWalletFlag(""),
      nextWalletFlag("trusted"),
      nextWalletFlag("watch"),
      nextWalletFlag("blocked"),
    ]).toEqual(["trusted", "watch", "blocked", ""]);
  });
});
