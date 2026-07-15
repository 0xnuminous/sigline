import { describe, expect, it } from "vitest";
import { getAddress } from "ethers";
import {
  MAX_PROFILE_PINS_PER_SCOPE,
  ProfileEventItem,
  getProfilePinStatus,
  makeProfilePin,
  normalizeProfilePin,
  normalizeProfilePins,
  normalizeProfilePinsByScope,
  profilePinScopeKey,
  summarizeProfileWatch,
  summarizeProfileWatches,
} from "./profiles";

const ACCOUNT_A = "0x8fc6e1d2f21bb22b1013d05ecf1f06fd73cdcb34";
const ACCOUNT_B = "0xab7c8803962c0f2f5bbbe3fa8bf41cd82aa1923c";
const ACCOUNT_A_CHECKSUM = getAddress(ACCOUNT_A);

function event(overrides: Partial<ProfileEventItem>): ProfileEventItem {
  return {
    id: "event-1",
    account: ACCOUNT_A,
    kind: "updated",
    nick: "alice",
    twtUrl: "https://example.com/alice.txt",
    updatedAt: 100,
    txHash: `0x${"a".repeat(64)}`,
    blockNumber: 1,
    logIndex: 0,
    ...overrides,
  };
}

describe("summarizeProfileWatch", () => {
  it("detects alias changes in chronological order", () => {
    const watch = summarizeProfileWatch([
      event({ nick: "alice", blockNumber: 10 }),
      event({ nick: "cipher", blockNumber: 15 }),
    ]);

    expect(watch).toMatchObject({
      changed: true,
      tone: "warn",
      label: "alias changed",
      eventCount: 2,
    });
    expect(watch.detail).toContain("Address remains the identity");
  });

  it("detects twtxt URL changes without requiring an alias change", () => {
    const watch = summarizeProfileWatch([
      event({ twtUrl: "https://example.com/old.txt", blockNumber: 10 }),
      event({ twtUrl: "https://example.com/new.txt", blockNumber: 20 }),
    ]);

    expect(watch.label).toBe("URL changed");
    expect(watch.changed).toBe(true);
  });

  it("warns when a previously set profile is cleared", () => {
    const watch = summarizeProfileWatch([
      event({ nick: "alice", blockNumber: 10 }),
      event({ kind: "cleared", nick: "", twtUrl: "", blockNumber: 20 }),
    ]);

    expect(watch).toMatchObject({
      changed: true,
      tone: "warn",
      label: "profile cleared",
    });
  });

  it("does not warn when repeated events preserve the same profile state", () => {
    const watch = summarizeProfileWatch([
      event({ blockNumber: 10 }),
      event({ blockNumber: 20 }),
    ]);

    expect(watch).toMatchObject({
      changed: false,
      tone: "idle",
      label: "profile first seen",
      eventCount: 2,
    });
  });

  it("groups watches by normalized account", () => {
    const watches = summarizeProfileWatches([
      event({ account: ACCOUNT_A.toUpperCase(), nick: "alice", blockNumber: 10 }),
      event({ account: ACCOUNT_A, nick: "cipher", blockNumber: 20 }),
      event({ account: ACCOUNT_B, nick: "bob", blockNumber: 30 }),
    ]);

    expect(watches[ACCOUNT_A.toLowerCase()].label).toBe("alias changed");
    expect(watches[ACCOUNT_B.toLowerCase()].label).toBe("profile first seen");
  });
});

describe("profile pins", () => {
  it("scopes pins by network, chain id, and contract", () => {
    expect(
      profilePinScopeKey("base-sepolia", 84532n, "0x0000000000000000000000000000000000000002"),
    ).toBe("base-sepolia:84532:0x0000000000000000000000000000000000000002");
    expect(
      profilePinScopeKey("base-sepolia", 8453n, "0x0000000000000000000000000000000000000002"),
    ).toBe("");
    expect(profilePinScopeKey("base", 8453n, "bad")).toBe("");
  });

  it("normalizes profile pins and rejects unsafe values", () => {
    expect(
      normalizeProfilePin({
        address: `0x${ACCOUNT_A.slice(2).toUpperCase()}`,
        nick: "  Alice   Base  ",
        twtUrl: " https://example.com/alice.txt ",
        updatedAt: 12.9,
        pinnedAt: 20.1,
        ignored: "drop",
      }),
    ).toEqual({
      address: ACCOUNT_A_CHECKSUM,
      nick: "Alice Base",
      twtUrl: "https://example.com/alice.txt",
      updatedAt: 12,
      pinnedAt: 20,
    });
    expect(
      normalizeProfilePin({
        address: ACCOUNT_A,
        nick: "\u202ebad",
        twtUrl: "",
      }),
    ).toBeUndefined();
  });

  it("dedupes, sorts, caps, and scopes restored pins", () => {
    const deduped = normalizeProfilePins({
      [ACCOUNT_A.toUpperCase()]: {
        nick: "old",
        twtUrl: "",
        updatedAt: 1,
        pinnedAt: 1,
      },
      [ACCOUNT_A]: {
        nick: "new",
        twtUrl: "",
        updatedAt: 2,
        pinnedAt: 2,
      },
    });
    expect(deduped[ACCOUNT_A]?.nick).toBe("new");

    const pins = normalizeProfilePins({
      bad: {
        nick: "bad",
      },
      ...Object.fromEntries(
        Array.from({ length: MAX_PROFILE_PINS_PER_SCOPE + 4 }, (_, index) => [
          `0x${(index + 1).toString(16).padStart(40, "0")}`,
          {
            nick: `pin-${index}`,
            twtUrl: "",
            updatedAt: index,
            pinnedAt: index,
          },
        ]),
      ),
    });
    expect(Object.keys(pins)).toHaveLength(MAX_PROFILE_PINS_PER_SCOPE);

    expect(
      normalizeProfilePinsByScope({
        "base-sepolia:84532:0x0000000000000000000000000000000000000002": {
          [ACCOUNT_A]: {
            nick: "alice",
            twtUrl: "",
            updatedAt: 1,
            pinnedAt: 1,
          },
        },
        ["__proto__"]: {
          [ACCOUNT_B]: { nick: "bad" },
        },
        "base-sepolia:8453:0x0000000000000000000000000000000000000002": {
          [ACCOUNT_B]: { nick: "wrong chain" },
        },
      }),
    ).toEqual({
      "base-sepolia:84532:0x0000000000000000000000000000000000000002": {
        [ACCOUNT_A]: {
          address: ACCOUNT_A_CHECKSUM,
          nick: "alice",
          twtUrl: "",
          updatedAt: 1,
          pinnedAt: 1,
        },
      },
    });
  });

  it("warns when the current sigcard no longer matches the pin", () => {
    const pin = makeProfilePin({
      address: ACCOUNT_A,
      nick: "alice",
      twtUrl: "https://example.com/alice.txt",
      updatedAt: 100,
    });

    expect(
      getProfilePinStatus(pin, {
        address: ACCOUNT_A,
        nick: "alice",
        twtUrl: "https://example.com/alice.txt",
        updatedAt: 130,
      }),
    ).toMatchObject({
      changed: false,
      tone: "idle",
      label: "profile matches pin",
    });

    expect(
      getProfilePinStatus(pin, {
        address: ACCOUNT_A,
        nick: "alice",
        twtUrl: "https://example.com/alice.txt",
        updatedAt: 100,
      }),
    ).toMatchObject({
      changed: false,
      tone: "idle",
      label: "profile matches pin",
    });

    expect(
      getProfilePinStatus(pin, {
        address: ACCOUNT_A,
        nick: "cipher",
        twtUrl: "https://example.com/new.txt",
        updatedAt: 120,
      }),
    ).toMatchObject({
      changed: true,
      tone: "warn",
      label: "pinned alias and URL changed",
    });

    expect(
      getProfilePinStatus(pin, {
        address: ACCOUNT_A,
        nick: "",
        twtUrl: "",
        updatedAt: 0,
        available: false,
      }),
    ).toMatchObject({
      changed: true,
      tone: "warn",
      label: "profile unavailable",
    });
  });
});
