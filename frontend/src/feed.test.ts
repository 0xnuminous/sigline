import { describe, expect, it } from "vitest";
import { Wallet, getAddress } from "ethers";
import {
  REF_KIND_ECHO,
  REF_KIND_NONE,
  REF_KIND_REPLY,
  Sigcard,
  TimelineItem,
  ZERO_HASH,
  computePostContentHash,
} from "./chain";
import {
  attachBundleSignature,
  getFeedStats,
  getBundleSignatureMessage,
  getThreadChildrenByHash,
  lineNeedsCurrentCheck,
  parseFeedBundleImport,
  serializeFeedExport,
  serializeFollowPackExport,
  sortFeedRows,
} from "./feed";

const AUTHOR_A = "0x8fc6e1d2f21bb22b1013d05ecf1f06fd73cdcb34";
const AUTHOR_B = "0xab7c8803962c0f2f5bbbe3fa8bf41cd82aa1923c";
const HASH_A = `0x${"a".repeat(64)}`;
const HASH_B = `0x${"b".repeat(64)}`;
const HASH_C = `0x${"c".repeat(64)}`;
const CONTRACT = AUTHOR_B;
const CHAIN_ID = "84532";
const BUNDLE_SIGNER = new Wallet(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const SIGNED_AT = "2026-05-28T00:00:00.000Z";
const VALID_IPFS_CID =
  "bafkreiffiageitnd2hhgakt4dtqmkbshqakdfctt274gu52t25ddcpzh5e";
const VALID_ARWEAVE_ID = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function line(overrides: Partial<TimelineItem>): TimelineItem {
  return {
    id: String(overrides.contentHash ?? HASH_A),
    author: AUTHOR_A,
    index: 0n,
    createdAt: 100,
    contentHash: HASH_A,
    text: "hello",
    imageUri: "",
    imageHash: ZERO_HASH,
    refHash: ZERO_HASH,
    refKind: REF_KIND_NONE,
    txHash:
      "0x8b1db7fdcbfc7f18d46db47f36c8cfcf5d50e78f1a2ce3995c28198f54a01001",
    blockNumber: 1,
    ...overrides,
  };
}

function committedLine(overrides: Partial<TimelineItem> = {}) {
  const item = line(overrides);
  const contentHash = computePostContentHash(
    CONTRACT,
    BigInt(CHAIN_ID),
    item,
  ).toLowerCase();
  return { ...item, id: contentHash, contentHash };
}

async function signBundle(payload: string) {
  return attachBundleSignature(
    payload,
    BUNDLE_SIGNER.address,
    await BUNDLE_SIGNER.signMessage(getBundleSignatureMessage(payload)),
    SIGNED_AT,
  );
}

describe("sortFeedRows", () => {
  it("sorts without mutating the original rows", () => {
    const rows = [
      line({ contentHash: HASH_A, index: 0n, createdAt: 100 }),
      line({ contentHash: HASH_B, index: 1n, createdAt: 200 }),
      line({ contentHash: HASH_C, index: 2n, createdAt: 200 }),
    ];

    expect(sortFeedRows(rows, "newest").map((item) => item.contentHash)).toEqual([
      HASH_C,
      HASH_B,
      HASH_A,
    ]);
    expect(sortFeedRows(rows, "oldest").map((item) => item.contentHash)).toEqual([
      HASH_A,
      HASH_B,
      HASH_C,
    ]);
    expect(rows.map((item) => item.contentHash)).toEqual([HASH_A, HASH_B, HASH_C]);
  });
});

describe("getFeedStats", () => {
  it("counts visible wallets, media, references, and saved rows", () => {
    const rows = [
      line({ author: AUTHOR_A, contentHash: HASH_A }),
      line({
        author: AUTHOR_B,
        contentHash: HASH_B,
        imageUri: `ipfs://${VALID_IPFS_CID}`,
        imageHash:
          "0x1111111111111111111111111111111111111111111111111111111111111111",
      }),
      line({
        author: AUTHOR_B,
        contentHash: HASH_C,
        refHash: HASH_A,
        refKind: REF_KIND_REPLY,
      }),
    ];

    expect(getFeedStats(rows, new Set([HASH_C]), new Set([HASH_A]))).toEqual({
      lines: 3,
      media: 1,
      refs: 1,
      wallets: 2,
      unread: 2,
      saved: 1,
    });
  });
});

describe("lineNeedsCurrentCheck", () => {
  it("includes only real rows without current live proof", () => {
    const unchecked = line({ id: "real", contentHash: HASH_A });
    const checked = line({ id: "checked", contentHash: HASH_B });
    const sample = line({ id: "sample-1", contentHash: HASH_C });

    expect(lineNeedsCurrentCheck(unchecked, { trusted: false })).toBe(true);
    expect(lineNeedsCurrentCheck(checked, { trusted: true })).toBe(false);
    expect(lineNeedsCurrentCheck(sample, { trusted: false })).toBe(false);
  });
});

describe("getThreadChildrenByHash", () => {
  it("groups loaded answers and echoes by referenced line hash", () => {
    const root = line({ contentHash: HASH_A, index: 0n });
    const answer = line({
      contentHash: HASH_B,
      index: 1n,
      refHash: HASH_A,
      refKind: REF_KIND_REPLY,
    });
    const echo = line({
      contentHash: HASH_C,
      index: 2n,
      refHash: HASH_A,
      refKind: REF_KIND_ECHO,
    });

    const children = getThreadChildrenByHash([root, answer, echo]);

    expect(children.get(HASH_A)?.answers.map((item) => item.contentHash)).toEqual([
      HASH_B,
    ]);
    expect(children.get(HASH_A)?.echoes.map((item) => item.contentHash)).toEqual([
      HASH_C,
    ]);
  });
});

describe("parseFeedBundleImport", () => {
  it("validates a public feed bundle and returns unique tracked authors", () => {
    const rowA = committedLine({ author: AUTHOR_A, index: 1n });
    const rowB = committedLine({ author: AUTHOR_B, index: 2n });
    const rowC = committedLine({ author: AUTHOR_A, index: 3n });
    const payload = serializeFeedExport([rowA, rowB, rowC], {}, {
      exportedAt: "2026-05-28T00:00:00.000Z",
      network: "base-sepolia",
      chainId: CHAIN_ID,
      contract: CONTRACT,
    });

    expect(
      parseFeedBundleImport(payload, {
        network: "base-sepolia",
        chainId: CHAIN_ID,
        contract: CONTRACT,
      }),
    ).toMatchObject({
      schema: "sigline.feed.v1",
      lineCount: 3,
      authors: [getAddress(AUTHOR_A), getAddress(AUTHOR_B)].sort(),
      context: {
        network: "base-sepolia",
        chainId: CHAIN_ID,
        contract: getAddress(CONTRACT),
      },
      warnings: [],
    });
  });

  it("rejects bundles with mismatched context", () => {
    const payload = serializeFeedExport([committedLine()], {}, {
      network: "base",
      chainId: "8453",
      contract: CONTRACT,
    });

    expect(() =>
      parseFeedBundleImport(payload, {
        network: "base-sepolia",
        chainId: CHAIN_ID,
        contract: CONTRACT,
      }),
    ).toThrow("Feed bundle network does not match");
  });

  it("rejects malformed or oversized bundles before mutating local state", () => {
    expect(() => parseFeedBundleImport("{")).toThrow("JSON is invalid");
    expect(() =>
      parseFeedBundleImport(
        JSON.stringify({
          schema: "sigline.feed.v1",
          context: {
            network: "base-sepolia",
            chainId: CHAIN_ID,
            contract: CONTRACT,
          },
          lines: [],
        }),
      ),
    ).toThrow("no authors");
    expect(() => parseFeedBundleImport("x".repeat(128_001))).toThrow("over 128 KB");
  });

  it("requires full context before importing as a local follow pack", () => {
    expect(() =>
      parseFeedBundleImport(
        JSON.stringify({
          schema: "sigline.feed.v1",
          lines: [
            {
              author: AUTHOR_A,
              index: "0",
              createdAt: 100,
              blockNumber: 1,
              contentHash: HASH_A,
              txHash:
                "0x8b1db7fdcbfc7f18d46db47f36c8cfcf5d50e78f1a2ce3995c28198f54a01001",
            },
          ],
        }),
      ),
    ).toThrow("context must include");
  });

  it("rejects bundles whose content hash does not commit to the line fields", () => {
    const row = committedLine({ text: "original text" });
    const payload = JSON.parse(
      serializeFeedExport([row], {}, {
        network: "base-sepolia",
        chainId: CHAIN_ID,
        contract: CONTRACT,
      }),
    );
    payload.lines[0].text = "tampered text";

    expect(() =>
      parseFeedBundleImport(JSON.stringify(payload), {
        network: "base-sepolia",
        chainId: CHAIN_ID,
        contract: CONTRACT,
      }),
    ).toThrow("mismatched contentHash");
  });

  it("accepts legacy HTTPS image pointers but warns about external media", () => {
    const row = committedLine({
      imageUri: "https://example.com/image.png",
      imageHash:
        "0x1111111111111111111111111111111111111111111111111111111111111111",
    });
    const payload = serializeFeedExport([row], {}, {
      network: "base-sepolia",
      chainId: CHAIN_ID,
      contract: CONTRACT,
    });

    expect(
      parseFeedBundleImport(payload, {
        network: "base-sepolia",
        chainId: CHAIN_ID,
        contract: CONTRACT,
      }).warnings,
    ).toEqual(["1 bundled image URI use HTTPS; verify image bytes before rendering."]);
  });

  it("rejects malformed decentralized media pointers in bundles", () => {
    const row = committedLine();
    const payload = JSON.parse(
      serializeFeedExport([row], {}, {
        network: "base-sepolia",
        chainId: CHAIN_ID,
        contract: CONTRACT,
      }),
    );
    payload.lines[0].imageUri = "ipfs://bafyimage";
    payload.lines[0].imageHash =
      "0x1111111111111111111111111111111111111111111111111111111111111111";

    expect(() =>
      parseFeedBundleImport(JSON.stringify(payload), {
        network: "base-sepolia",
        chainId: CHAIN_ID,
        contract: CONTRACT,
      }),
    ).toThrow("invalid imageUri");
  });

  it("imports compact follow packs with the same context checks", () => {
    const payload = serializeFollowPackExport([AUTHOR_A, AUTHOR_B, AUTHOR_A], {
      [AUTHOR_A.toLowerCase()]: {
        address: AUTHOR_A,
        nick: "cipher",
        twtUrl: "",
        updatedAt: 0,
        postCount: 0n,
      },
    }, {
      exportedAt: "2026-05-28T00:00:00.000Z",
      network: "base-sepolia",
      chainId: CHAIN_ID,
      contract: CONTRACT,
    });

    expect(JSON.parse(payload)).toMatchObject({
      schema: "sigline.followPack.v1",
      count: 2,
      wallets: [
        { address: getAddress(AUTHOR_A), alias: "cipher" },
        { address: getAddress(AUTHOR_B) },
      ],
    });
    expect(
      parseFeedBundleImport(payload, {
        network: "base-sepolia",
        chainId: CHAIN_ID,
        contract: CONTRACT,
      }),
    ).toMatchObject({
      schema: "sigline.followPack.v1",
      lineCount: 0,
      authors: [getAddress(AUTHOR_A), getAddress(AUTHOR_B)].sort(),
    });
  });

  it("refuses to export follow packs without complete public context", () => {
    expect(() =>
      serializeFollowPackExport([AUTHOR_A], {}, {
        network: "base-sepolia",
        chainId: CHAIN_ID,
        contract: "",
      }),
    ).toThrow("contract is invalid");
  });

  it("verifies signed follow packs and rejects payload tampering", async () => {
    const unsigned = serializeFollowPackExport([AUTHOR_A], {}, {
      exportedAt: SIGNED_AT,
      network: "base-sepolia",
      chainId: CHAIN_ID,
      contract: CONTRACT,
    });
    const signed = await signBundle(unsigned);

    expect(
      parseFeedBundleImport(signed, {
        network: "base-sepolia",
        chainId: CHAIN_ID,
        contract: CONTRACT,
      }).signature,
    ).toMatchObject({
      signer: getAddress(BUNDLE_SIGNER.address),
      signedAt: SIGNED_AT,
    });

    const tampered = JSON.parse(signed);
    tampered.wallets.push({ address: AUTHOR_B });
    expect(() =>
      parseFeedBundleImport(JSON.stringify(tampered), {
        network: "base-sepolia",
        chainId: CHAIN_ID,
        contract: CONTRACT,
      }),
    ).toThrow("payload hash mismatch");
  });

  it("verifies signed feed bundles after line content checks", async () => {
    const row = committedLine({ author: AUTHOR_A, index: 7n });
    const unsigned = serializeFeedExport([row], {}, {
      exportedAt: SIGNED_AT,
      network: "base-sepolia",
      chainId: CHAIN_ID,
      contract: CONTRACT,
    });
    const signed = await signBundle(unsigned);

    expect(
      parseFeedBundleImport(signed, {
        network: "base-sepolia",
        chainId: CHAIN_ID,
        contract: CONTRACT,
      }),
    ).toMatchObject({
      schema: "sigline.feed.v1",
      authors: [getAddress(AUTHOR_A)],
      signature: {
        signer: getAddress(BUNDLE_SIGNER.address),
        signedAt: SIGNED_AT,
      },
    });
  });
});

describe("serializeFeedExport", () => {
  it("exports stable JSON without bigint values", () => {
    const sigcards: Record<string, Sigcard> = {
      [AUTHOR_A.toLowerCase()]: {
        address: AUTHOR_A,
        nick: "cipher",
        twtUrl: "",
        updatedAt: 0,
        postCount: 1n,
      },
    };
    const output = serializeFeedExport(
      [
        line({
          contentHash: HASH_A,
          index: 12n,
          imageUri: `ar://${VALID_ARWEAVE_ID}`,
          imageHash:
            "0x2222222222222222222222222222222222222222222222222222222222222222",
          refHash: HASH_B,
          refKind: REF_KIND_ECHO,
        }),
      ],
      sigcards,
      "2026-05-28T00:00:00.000Z",
    );

    expect(JSON.parse(output)).toEqual({
      schema: "sigline.feed.v1",
      exportedAt: "2026-05-28T00:00:00.000Z",
      count: 1,
      lines: [
        {
          author: AUTHOR_A,
          alias: "cipher",
          index: "12",
          createdAt: 100,
          blockNumber: 1,
          text: "hello",
          imageUri: `ar://${VALID_ARWEAVE_ID}`,
          imageHash:
            "0x2222222222222222222222222222222222222222222222222222222222222222",
          refHash: HASH_B,
          refKind: REF_KIND_ECHO,
          contentHash: HASH_A,
          txHash:
            "0x8b1db7fdcbfc7f18d46db47f36c8cfcf5d50e78f1a2ce3995c28198f54a01001",
        },
      ],
    });
  });

  it("can include public context and per-line proof metadata", () => {
    const row = committedLine({ index: 1n });
    const output = serializeFeedExport([row], {}, {
      exportedAt: "2026-05-28T00:00:00.000Z",
      network: "base-sepolia",
      chainId: CHAIN_ID,
      contract: CONTRACT,
      lineExtras: (item) => ({
        publicUrl: `https://sigline.example/?line=${item.contentHash}`,
        verification: {
          sameRpc: "same-rpc ok",
          independent: "2-rpc ok",
        },
        local: {
          saved: true,
          tracked: false,
        },
      }),
    });

    expect(JSON.parse(output)).toMatchObject({
      schema: "sigline.feed.v1",
      context: {
        network: "base-sepolia",
        chainId: "84532",
        contract: AUTHOR_B,
      },
      lines: [
        {
          contentHash: row.contentHash,
          publicUrl: `https://sigline.example/?line=${row.contentHash}`,
          verification: {
            sameRpc: "same-rpc ok",
            independent: "2-rpc ok",
          },
          local: {
            saved: true,
            tracked: false,
          },
        },
      ],
    });
  });

  it("does not include private local feed settings by default", () => {
    const output = serializeFeedExport([committedLine({ text: "base builders" })], {}, {
      exportedAt: "2026-05-28T00:00:00.000Z",
      network: "base-sepolia",
      chainId: CHAIN_ID,
      contract: CONTRACT,
    });

    expect(output).not.toContain("highlightedTerms");
    expect(output).not.toContain("walletLabels");
    expect(output).not.toContain("walletFlags");
    expect(output).not.toContain("lineNotes");
    expect(output).not.toContain("lineMarks");
    expect(output).not.toContain("readerLenses");
    expect(output).not.toContain("profilePins");
  });
});
