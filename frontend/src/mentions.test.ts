import { describe, expect, it } from "vitest";
import { REF_KIND_NONE, Sigcard, TimelineItem, ZERO_HASH } from "./chain";
import {
  lineMentionsTarget,
  mentionTargetFromAddress,
  normalizeMentionAlias,
  parseMentions,
  summarizeMentions,
} from "./mentions";

const AUTHOR = "0xab7c8803962c0f2f5bbbe3fa8bf41cd82aa1923c";
const TARGET = "0x8fc6e1d2f21bb22b1013d05ecf1f06fd73cdcb34";

function line(
  text: string,
  contentHash = `0x${"a".repeat(64)}`,
  createdAt = 100,
): TimelineItem {
  return {
    id: contentHash,
    author: AUTHOR,
    index: 0n,
    createdAt,
    contentHash,
    text,
    imageUri: "",
    imageHash: ZERO_HASH,
    refHash: ZERO_HASH,
    refKind: REF_KIND_NONE,
    txHash: `0x${"b".repeat(64)}`,
    blockNumber: 1,
  };
}

describe("parseMentions", () => {
  it("parses address and alias mentions with dedupe and caps", () => {
    const mentions = parseMentions(
      `hello @Cipher @cipher @${TARGET} ${Array.from(
        { length: 20 },
        (_, index) => `@user${index}`,
      ).join(" ")}`,
    );

    expect(mentions.slice(0, 3).map((mention) => [mention.kind, mention.token])).toEqual([
      ["alias", "cipher"],
      ["address", TARGET],
      ["alias", "user0"],
    ]);
    expect(mentions).toHaveLength(12);
  });

  it("rejects emails, URL path segments, unicode, invalid addresses, and 0x aliases", () => {
    expect(
      parseMentions(
        "a@cipher https://example.com/@cipher @ciphér @0xfeed @0x123 @ok_name",
      ).map((mention) => mention.token),
    ).toEqual(["ok_name"]);
  });
});

describe("mention targets", () => {
  it("builds targets from addresses plus current sigcard alias", () => {
    const sigcards: Record<string, Sigcard> = {
      [TARGET.toLowerCase()]: {
        address: TARGET,
        nick: "Cipher",
        twtUrl: "",
        updatedAt: 1,
        postCount: 1n,
      },
    };

    expect(mentionTargetFromAddress(TARGET, sigcards)).toEqual({
      address: "0x8Fc6E1d2f21BB22b1013d05Ecf1f06Fd73cDCB34",
      aliases: ["cipher"],
    });
    expect(mentionTargetFromAddress("bad", sigcards)).toBeUndefined();
  });

  it("matches aliases case-insensitively and addresses exactly", () => {
    const target = {
      address: "0x8Fc6E1d2f21BB22b1013d05Ecf1f06Fd73cDCB34",
      aliases: ["cipher"],
    };

    expect(lineMentionsTarget(line("hey @Cipher"), target)).toBe(true);
    expect(lineMentionsTarget(line(`hey @${TARGET.toUpperCase()}`), target)).toBe(
      true,
    );
    expect(lineMentionsTarget(line("hey @other"), target)).toBe(false);
  });

  it("summarizes mention count and unread state", () => {
    const rows = [
      line("hey @cipher", `0x${"1".repeat(64)}`),
      line("hey @other", `0x${"2".repeat(64)}`),
      line(`hey @${TARGET}`, `0x${"3".repeat(64)}`),
    ];
    const summary = summarizeMentions(
      rows,
      { address: TARGET, aliases: ["cipher"] },
      new Set([`0x${"1".repeat(64)}`]),
    );

    expect(summary).toMatchObject({ count: 2, unread: 1 });
  });
});

describe("normalizeMentionAlias", () => {
  it("normalizes safe local aliases only", () => {
    expect(normalizeMentionAlias(" Cipher_1 ")).toBe("cipher_1");
    expect(normalizeMentionAlias("0xfeed")).toBe("");
    expect(normalizeMentionAlias("bad space")).toBe("");
    expect(normalizeMentionAlias("x".repeat(80))).toBe("");
  });
});
