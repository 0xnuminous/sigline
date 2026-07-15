import { afterEach, describe, expect, it, vi } from "vitest";
import { getAddress } from "ethers";
import {
  ABI,
  DEFAULT_FROM_BLOCK,
  DEFAULT_NETWORK,
  EXPECTED_POST_TYPEHASH,
  MAX_MUTED_TERMS,
  STORAGE_KEY,
  TimelineItem,
  ZERO_HASH,
  assertExpectedTreasury,
  computePostContentHash,
  getDisplayErrorMessage,
  normalizeMutedTerm,
  readSavedSettings,
} from "./chain";
import { readerSourceIdFromName } from "./readerSources";

const CONTRACT_A = "0x0000000000000000000000000000000000000002";
const CONTRACT_B = "0x0000000000000000000000000000000000000003";
const AUTHOR = "0x8fc6e1d2f21bb22b1013d05ecf1f06fd73cdcb34";
const CONTENT_HASH =
  "0x58c7f3f1e5cf51e2a3bb5f219b8fd32b3e91e50c092116b12dd58f7d3a410001";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubSavedState(value: unknown) {
  const raw = JSON.stringify(value);
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => (key === STORAGE_KEY ? raw : null)),
  });
}

function validDraftReference(overrides: Record<string, unknown> = {}) {
  return {
    mode: "echo",
    networkKey: "base-sepolia",
    contractAddress: CONTRACT_A,
    author: AUTHOR,
    index: "2",
    createdAt: 1842041,
    contentHash: CONTENT_HASH,
    text: "Posting from a wallet, reading from the contract.",
    imageUri: "",
    imageHash: ZERO_HASH,
    refHash: ZERO_HASH,
    refKind: 0,
    txHash:
      "0x8b1db7fdcbfc7f18d46db47f36c8cfcf5d50e78f1a2ce3995c28198f54a01001",
    blockNumber: 1842041,
    ...overrides,
  };
}

describe("readSavedSettings", () => {
  it("rejects malformed primitive settings without crashing", () => {
    stubSavedState({
      networkKey: "__proto__",
      contractsByNetwork: {
        "base-sepolia": CONTRACT_A,
        base: CONTRACT_B,
      },
      rpcUrl: 42,
      fromBlock: false,
      nextScanBlock: {},
      draftText: 123,
      draftQueue: [
        {
          id: "draft:one",
          createdAt: 1,
          updatedAt: 2,
          networkKey: "base-sepolia",
          contractAddress: CONTRACT_A,
          text: "queued",
          imageUri: "ipfs://bafyqueued",
          imageHash: CONTENT_HASH,
          reference: validDraftReference(),
          rawFile: "drop me",
        },
        {
          id: "draft:bad",
          createdAt: 1,
          updatedAt: 2,
          networkKey: "__proto__",
          text: "bad",
        },
      ],
      imageUploadMode: [],
      imageUploadEndpoint: 7,
      imageGatewayMode: "configured",
      scanScope: null,
      feedSort: "oldest",
      trackedSigners: [AUTHOR, 55],
      mutedSigners: [false, AUTHOR],
      mutedTerms: [
        "  Rug   Pull  ",
        "rug pull",
        "x".repeat(41),
        false,
      ],
      highlightedTerms: [
        "  Base   Builders  ",
        "base builders",
        "\u202ebad",
        "x".repeat(41),
        false,
      ],
      walletLabels: {
        [`0x${AUTHOR.slice(2).toUpperCase()}`]: "  Alice   Base  ",
        "0xdead": "bad",
        [CONTRACT_A]: "\u202ebad",
        __proto__: "drop",
      },
      walletFlags: {
        [`0x${AUTHOR.slice(2).toUpperCase()}`]: "watch",
        "0xdead": "blocked",
        [CONTRACT_A]: "bad",
        __proto__: "drop",
      },
      lineNotes: {
        [`0x${CONTENT_HASH.slice(2).toUpperCase()}`]: "  follow   up  ",
        "0xdead": "bad",
        [`0x${"b".repeat(64)}`]: "\u202ebad",
        __proto__: "drop",
      },
      lineMarks: {
        [`0x${CONTENT_HASH.slice(2).toUpperCase()}`]: "signal",
        "0xdead": "verify",
        [`0x${"b".repeat(64)}`]: "like",
        __proto__: "drop",
      },
      pinnedChannelsByScope: {
        "base-sepolia:0xab7c8803962c0f2f5bbbe3fa8bf41cd82aa1923c": [
          "tag:base",
          2,
          "cash:ETH",
        ],
      },
      circlesByScope: {
        "base-sepolia:0xab7c8803962c0f2f5bbbe3fa8bf41cd82aa1923c": [
          {
            name: "Close",
            addresses: [AUTHOR, AUTHOR.toUpperCase(), "bad"],
          },
        ],
        "__proto__": [{ name: "Bad", addresses: [AUTHOR] }],
      },
      readerLensesByScope: {
        "base-sepolia:0x0000000000000000000000000000000000000002": [
          {
            name: "Needs Check Builders",
            query: "base",
            mode: "needs-check",
            channel: "#Base",
            circle: "circle:close",
            sort: "oldest",
            showMuted: true,
            updatedAt: 2,
          },
        ],
        "__proto__": [{ name: "Bad" }],
      },
      readerSources: [
        {
          name: "Base Builders",
          networkKey: "base-sepolia",
          contractAddress: CONTRACT_A,
          fromBlock: "123",
          scanScope: "address",
          author: `0x${AUTHOR.slice(2).toUpperCase()}`,
          channel: "#Base",
          mode: "media",
          sort: "oldest",
          updatedAt: 4.9,
          rpcUrl: "https://private.example",
          circle: "circle:close",
        },
        {
          name: "Bad",
          networkKey: "base",
          contractAddress: "bad",
        },
      ],
      profilePinsByScope: {
        "base-sepolia:84532:0x0000000000000000000000000000000000000002": {
          [`0x${AUTHOR.slice(2).toUpperCase()}`]: {
            nick: "  Alice  ",
            twtUrl: " https://example.com/alice.txt ",
            updatedAt: 2.9,
            pinnedAt: 3.1,
          },
          "0xdead": {
            nick: "bad",
          },
        },
        "base-sepolia:8453:0x0000000000000000000000000000000000000002": {
          [AUTHOR]: {
            nick: "wrong chain",
          },
        },
        "__proto__": {
          [AUTHOR]: { nick: "Bad" },
        },
      },
      readLines: [CONTENT_HASH.toUpperCase(), CONTENT_HASH, "0xdead", 7],
      savedLines: [CONTENT_HASH, 2],
      savedLineCache: {
        [CONTENT_HASH]: {
          networkKey: "base-sepolia",
          contractAddress: CONTRACT_A,
          savedAt: 1_777_777_777,
          publicUrl: "https://sigline.example/?sigline=line",
          author: AUTHOR,
          index: "2",
          createdAt: 1842041,
          contentHash: CONTENT_HASH,
          text: "cached line",
          imageUri: "",
          imageHash: ZERO_HASH,
          refHash: ZERO_HASH,
          refKind: 0,
          txHash:
            "0x8b1db7fdcbfc7f18d46db47f36c8cfcf5d50e78f1a2ce3995c28198f54a01001",
          blockNumber: 1842041,
          proof: {
            sameRpc: { tone: "good", status: "same-rpc ok" },
            independent: { tone: "__bad", status: "ignored" },
          },
        },
        "0xdead": {
          networkKey: "base-sepolia",
        },
      },
    });

    const saved = readSavedSettings();

    expect(saved.networkKey).toBe(DEFAULT_NETWORK);
    expect(saved.rpcUrl).toBeTruthy();
    expect(saved.fromBlock).toBe(DEFAULT_FROM_BLOCK);
    expect(saved.nextScanBlock).toBe("");
    expect(saved.draftText).toBe("");
    expect(saved.draftQueue).toEqual([
      {
        id: "draft:one",
        createdAt: 1,
        updatedAt: 2,
        networkKey: "base-sepolia",
        contractAddress: CONTRACT_A,
        text: "queued",
        imageUri: "ipfs://bafyqueued",
        imageHash: CONTENT_HASH,
        reference: {
          ...validDraftReference(),
          contractAddress: CONTRACT_A,
          author: getAddress(AUTHOR),
          contentHash: CONTENT_HASH,
          imageHash: ZERO_HASH,
          refHash: ZERO_HASH,
          txHash:
            "0x8b1db7fdcbfc7f18d46db47f36c8cfcf5d50e78f1a2ce3995c28198f54a01001",
        },
      },
    ]);
    expect(saved.imageUploadMode).toBeUndefined();
    expect(saved.imageUploadEndpoint).toBeUndefined();
    expect(saved.imageGatewayMode).toBe("configured");
    expect(saved.scanScope).toBeUndefined();
    expect(saved.feedSort).toBe("oldest");
    expect(saved.trackedSigners).toEqual([AUTHOR]);
    expect(saved.mutedSigners).toEqual([AUTHOR]);
    expect(saved.mutedTerms).toEqual(["rug pull"]);
    expect(saved.highlightedTerms).toEqual(["base builders"]);
    expect(saved.walletLabels).toEqual({
      [AUTHOR]: "Alice Base",
    });
    expect(saved.walletFlags).toEqual({
      [AUTHOR]: "watch",
    });
    expect(saved.lineNotes).toEqual({
      [CONTENT_HASH]: "follow up",
    });
    expect(saved.lineMarks).toEqual({
      [CONTENT_HASH]: "important",
    });
    expect(saved.pinnedChannelsByScope).toEqual({
      "base-sepolia:0xab7c8803962c0f2f5bbbe3fa8bf41cd82aa1923c": [
        "tag:base",
        "cash:ETH",
      ],
    });
    expect(saved.circlesByScope).toEqual({
      "base-sepolia:0xab7c8803962c0f2f5bbbe3fa8bf41cd82aa1923c": [
        {
          id: "circle:close",
          name: "Close",
          addresses: [getAddress(AUTHOR)],
        },
      ],
    });
    expect(saved.readerLensesByScope).toEqual({
      "base-sepolia:0x0000000000000000000000000000000000000002": [
        {
          id: "lens:needs-check-builders",
          name: "Needs Check Builders",
          query: "base",
          mode: "needs-check",
          channel: "tag:base",
          circle: "circle:close",
          sort: "oldest",
          showMuted: true,
          updatedAt: 2,
        },
      ],
    });
    expect(saved.readerSources).toEqual([
      {
        id: readerSourceIdFromName("Base Builders"),
        name: "Base Builders",
        networkKey: "base-sepolia",
        contractAddress: getAddress(CONTRACT_A),
        fromBlock: "123",
        scanScope: "address",
        author: getAddress(AUTHOR),
        channel: "tag:base",
        mode: "media",
        sort: "oldest",
        updatedAt: 4,
      },
    ]);
    expect(saved.profilePinsByScope).toEqual({
      "base-sepolia:84532:0x0000000000000000000000000000000000000002": {
        [AUTHOR]: {
          address: getAddress(AUTHOR),
          nick: "Alice",
          twtUrl: "https://example.com/alice.txt",
          updatedAt: 2,
          pinnedAt: 3,
        },
      },
    });
    expect(saved.readLines).toEqual([CONTENT_HASH]);
    expect(saved.savedLines).toEqual([CONTENT_HASH]);
    expect(saved.savedLineCache?.[CONTENT_HASH]).toMatchObject({
      networkKey: "base-sepolia",
      contractAddress: CONTRACT_A,
      index: "2",
      text: "cached line",
      proof: {
        sameRpc: { tone: "good", status: "same-rpc ok" },
      },
    });
    expect(saved.savedLineCache?.[CONTENT_HASH].author.toLowerCase()).toBe(AUTHOR);
    expect(saved.savedLineCache?.[CONTENT_HASH].proof?.independent).toBeUndefined();
    expect(saved.savedLineCache?.["0xdead"]).toBeUndefined();
  });

  it("keeps a valid scoped draft reference", () => {
    stubSavedState({
      networkKey: "base-sepolia",
      contractsByNetwork: { "base-sepolia": CONTRACT_A, base: "" },
      draftText: "reference draft",
      draftReference: validDraftReference(),
    });

    const saved = readSavedSettings();

    expect(saved.draftText).toBe("reference draft");
    expect(saved.draftReference).toMatchObject({
      mode: "echo",
      networkKey: "base-sepolia",
      contractAddress: CONTRACT_A,
      index: "2",
      contentHash: CONTENT_HASH,
    });
    expect(saved.draftReference?.author.toLowerCase()).toBe(AUTHOR);
  });

  it("falls back to the restored network rpc when rpcUrl is missing", () => {
    stubSavedState({
      networkKey: "base",
    });

    expect(readSavedSettings().rpcUrl).toBe("https://mainnet.base.org");
  });

  it("drops draft references with inherited or invalid network keys", () => {
    stubSavedState({
      networkKey: "base-sepolia",
      contractsByNetwork: { "base-sepolia": CONTRACT_A, base: "" },
      draftReference: validDraftReference({ networkKey: "__proto__" }),
    });

    expect(readSavedSettings().draftReference).toBeUndefined();
  });

  it("drops draft references with invalid transaction hashes", () => {
    stubSavedState({
      networkKey: "base-sepolia",
      contractsByNetwork: { "base-sepolia": CONTRACT_A, base: "" },
      draftReference: validDraftReference({ txHash: "0x1234" }),
    });

    expect(readSavedSettings().draftReference).toBeUndefined();
  });

  it("caps restored local read state", () => {
    stubSavedState({
      readLines: Array.from(
        { length: 505 },
        (_, index) => `0x${index.toString(16).padStart(64, "0")}`,
      ),
    });

    expect(readSavedSettings().readLines).toHaveLength(500);
  });
});

describe("normalizeMutedTerm", () => {
  it("normalizes local text mutes and rejects empty or oversized terms", () => {
    expect(normalizeMutedTerm("  RUG   Pull  ")).toBe("rug pull");
    expect(normalizeMutedTerm("")).toBe("");
    expect(normalizeMutedTerm("x".repeat(41))).toBe("");
  });

  it("caps restored local text mutes", () => {
    stubSavedState({
      mutedTerms: Array.from({ length: MAX_MUTED_TERMS + 5 }, (_, index) =>
        `term-${String(index).padStart(2, "0")}`,
      ),
    });

    expect(readSavedSettings().mutedTerms).toHaveLength(MAX_MUTED_TERMS);
  });
});

describe("contract identity constants", () => {
  it("matches the Sigline contract post typehash", () => {
    expect(EXPECTED_POST_TYPEHASH).toBe(
      "0xbd99c7a823bc87523242a43dcfc3b6d9f62d76376662be4593948a01b029596a",
    );
  });

  it("exposes the profile clear contract method to the frontend", () => {
    expect(ABI).toContain("function clearProfile()");
    expect(ABI).toContain("event ProfileCleared(address indexed account)");
  });

  it("explains when the wallet signer changes during a scoped write", () => {
    expect(getDisplayErrorMessage(new Error("SIGNER_ACCOUNT_CHANGED"))).toBe(
      "Wallet account changed. Review the account and try again",
    );
  });

  it("enforces the configured treasury only for write checks", () => {
    expect(() =>
      assertExpectedTreasury(CONTRACT_A, false, CONTRACT_B),
    ).not.toThrow();
    expect(() => assertExpectedTreasury(CONTRACT_A, true, CONTRACT_B)).toThrow(
      "TREASURY_MISMATCH",
    );
    expect(() => assertExpectedTreasury(CONTRACT_A, true, "")).toThrow(
      "TREASURY_NOT_CONFIGURED",
    );
  });
});

describe("computePostContentHash", () => {
  it("matches the fixed Sigline EIP-712 content hash vector", () => {
    const item: TimelineItem = {
      id: "fixture",
      author: AUTHOR,
      index: 2n,
      createdAt: 1842041,
      contentHash: CONTENT_HASH,
      text: "Posting from a wallet, reading from the contract.",
      imageUri: "",
      imageHash: ZERO_HASH,
      refHash: ZERO_HASH,
      refKind: 0,
      txHash:
        "0x8b1db7fdcbfc7f18d46db47f36c8cfcf5d50e78f1a2ce3995c28198f54a01001",
      blockNumber: 1842041,
    };

    expect(computePostContentHash(CONTRACT_A, 84532n, item)).toBe(
      "0x37afd074bd2b6a86966d68061234a1bf350397d8cfdf13d79e2b8116c918119b",
    );
  });
});
