import { describe, expect, it } from "vitest";
import {
  REF_KIND_ECHO,
  REF_KIND_NONE,
  REF_KIND_REPLY,
  TimelineItem,
  ZERO_HASH,
} from "./chain";
import { MAX_DIGEST_ROWS, serializeFeedDigest } from "./digests";

const AUTHOR = "0x8fc6e1d2f21bb22b1013d05ecf1f06fd73cdcb34";
const HASH = `0x${"a".repeat(64)}`;
const REF_HASH = `0x${"b".repeat(64)}`;
const IMAGE_HASH = `0x${"c".repeat(64)}`;

function line(overrides: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id: HASH,
    author: AUTHOR,
    index: 0n,
    createdAt: 1_000,
    contentHash: HASH,
    text: "Small feed. Public history.",
    imageUri: "",
    imageHash: ZERO_HASH,
    refHash: ZERO_HASH,
    refKind: REF_KIND_NONE,
    txHash:
      "0x8b1db7fdcbfc7f18d46db47f36c8cfcf5d50e78f1a2ce3995c28198f54a01001",
    blockNumber: 123,
    ...overrides,
  };
}

describe("serializeFeedDigest", () => {
  it("serializes visible rows as a deterministic clipboard digest", () => {
    const digest = serializeFeedDigest(
      [
        line(),
        line({
          index: 1n,
          text: "",
          imageUri: "ipfs://bafkreiffiageitnd2hhgakt4dtqmkbshqakdfctt274gu52t25ddcpzh5e",
          imageHash: IMAGE_HASH,
          refHash: REF_HASH,
          refKind: REF_KIND_REPLY,
          blockNumber: 124,
        }),
        line({
          index: 2n,
          text: "",
          refHash: REF_HASH,
          refKind: REF_KIND_ECHO,
          blockNumber: 125,
        }),
      ],
      {
        network: "base.sepolia",
        contract: AUTHOR,
        scope: "everyone",
        generatedAt: "2026-05-28T00:00:00.000Z",
      },
    );

    expect(digest).toContain("Sigline feed digest");
    expect(digest).toContain("generated: 2026-05-28T00:00:00.000Z");
    expect(digest).toContain("network: base.sepolia");
    expect(digest).toContain("scope: everyone");
    expect(digest).toContain("rows: 3");
    expect(digest).toContain("text: Small feed. Public history.");
    expect(digest).toContain("ref: answer 0xbbbbbb...bbbbbb");
    expect(digest).toContain("media: 0xcccccc...cccccc ipfs://");
    expect(digest).toContain("ref: echo 0xbbbbbb...bbbbbb");
    expect(digest).toContain("text: [reference only]");
  });

  it("caps rows defensively and reports truncation", () => {
    const rows = Array.from({ length: MAX_DIGEST_ROWS + 2 }, (_, index) =>
      line({ index: BigInt(index), contentHash: `0x${String(index).padStart(64, "a")}` }),
    );

    const digest = serializeFeedDigest(rows, {
      network: "base",
      contract: AUTHOR,
      generatedAt: "2026-05-28T00:00:00.000Z",
      limit: 999,
    });

    expect(digest).toContain(`rows: ${MAX_DIGEST_ROWS}/${MAX_DIGEST_ROWS + 2}`);
    expect(digest).toContain("truncated: 2 rows omitted");
    expect(digest).not.toContain(`${MAX_DIGEST_ROWS + 1}.`);
  });

  it("truncates long text without exceeding the digest text budget", () => {
    const digest = serializeFeedDigest(
      [line({ text: "x".repeat(500) })],
      {
        network: "base",
        contract: AUTHOR,
        generatedAt: "2026-05-28T00:00:00.000Z",
      },
    );

    const textLine = digest
      .split("\n")
      .find((row) => row.trim().startsWith("text:"));
    expect(textLine).toBeDefined();
    expect(textLine?.endsWith("...")).toBe(true);
    expect(new TextEncoder().encode(textLine).length).toBeLessThanOrEqual(290);
  });
});
