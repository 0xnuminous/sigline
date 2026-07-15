import { describe, expect, it } from "vitest";
import {
  MAX_WALLET_LABELS,
  getWalletLabel,
  normalizeWalletLabel,
  normalizeWalletLabels,
  setWalletLabel,
} from "./labels";

const ADDRESS_A = "0x8fc6e1d2f21bb22b1013d05ecf1f06fd73cdcb34";
const ADDRESS_B = "0xab7c8803962c0f2f5bbbe3fa8bf41cd82aa1923c";
const ADDRESS_A_UPPER = `0x${ADDRESS_A.slice(2).toUpperCase()}`;

describe("normalizeWalletLabel", () => {
  it("trims, normalizes, and collapses label spacing", () => {
    expect(normalizeWalletLabel("  Alice   Base  ")).toBe("Alice Base");
  });

  it("rejects empty, oversized, and control-character labels", () => {
    expect(normalizeWalletLabel("   ")).toBe("");
    expect(normalizeWalletLabel("x".repeat(65))).toBe("");
    expect(normalizeWalletLabel("alice\u202ebad")).toBe("");
  });
});

describe("normalizeWalletLabels", () => {
  it("keeps checksum-valid wallet keys as lower-case lookup keys", () => {
    expect(
      normalizeWalletLabels({
        [ADDRESS_A_UPPER]: "Alice",
        bad: "drop",
        [ADDRESS_B]: "",
      }),
    ).toEqual({
      [ADDRESS_A]: "Alice",
    });
  });

  it("rejects inherited records and caps the stored label count", () => {
    const inherited = Object.create({ [ADDRESS_A]: "bad" });
    expect(normalizeWalletLabels(inherited)).toEqual({});

    const labels = Object.fromEntries(
      Array.from({ length: MAX_WALLET_LABELS + 1 }, (_, index) => [
        `0x${(index + 1).toString(16).padStart(40, "0")}`,
        `wallet ${index}`,
      ]),
    );
    expect(Object.keys(normalizeWalletLabels(labels))).toHaveLength(
      MAX_WALLET_LABELS,
    );
  });
});

describe("setWalletLabel", () => {
  it("sets, reads, and clears labels by normalized address", () => {
    const withLabel = setWalletLabel({}, ADDRESS_A_UPPER, "Alice");

    expect(getWalletLabel(withLabel, ADDRESS_A)).toBe("Alice");
    expect(setWalletLabel(withLabel, ADDRESS_A, "")).toEqual({});
  });

  it("keeps the current labels when the address is invalid", () => {
    const labels = setWalletLabel({}, ADDRESS_A, "Alice");

    expect(setWalletLabel(labels, "not an address", "Mallory")).toEqual(labels);
  });
});
