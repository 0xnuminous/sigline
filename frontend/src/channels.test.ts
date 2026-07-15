import { describe, expect, it } from "vitest";
import { REF_KIND_NONE, TimelineItem, ZERO_HASH } from "./chain";
import {
  channelFromId,
  channelScopeKey,
  filterRowsByChannel,
  lineMatchesChannel,
  mergePinnedChannels,
  normalizePinnedChannels,
  normalizePinnedChannelsByScope,
  parseLineChannels,
  summarizeChannels,
} from "./channels";

const AUTHOR = "0x8fc6e1d2f21bb22b1013d05ecf1f06fd73cdcb34";
const CONTRACT = "0xab7c8803962c0f2f5bbbe3fa8bf41cd82aa1923c";

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

describe("parseLineChannels", () => {
  it("parses, normalizes, dedupes, and caps local channel tokens", () => {
    const channels = parseLineChannels(
      "#Base #base_dev $eth $BTC #Base #one #two #three #four #five #six #seven",
    );

    expect(channels.map((item) => [item.id, item.label])).toEqual([
      ["tag:base", "#base"],
      ["tag:base_dev", "#base_dev"],
      ["cash:ETH", "$ETH"],
      ["cash:BTC", "$BTC"],
      ["tag:one", "#one"],
      ["tag:two", "#two"],
      ["tag:three", "#three"],
      ["tag:four", "#four"],
    ]);
  });

  it("rejects URL fragments, emails, hex-like values, unicode, numerics, and punctuation", () => {
    expect(
      parseLineChannels(
        "https://example.com/#base user@example.com #123 #báse #bad-tag 0xabc $123 $TOO-LONG-TICKR #ok",
      ).map((item) => item.id),
    ).toEqual(["tag:ok"]);
  });
});

describe("summarizeChannels", () => {
  it("summarizes count, latest, unread, pins, and stable order", () => {
    const rows = [
      line("#base #base $eth", `0x${"1".repeat(64)}`, 100),
      line("#base #art", `0x${"2".repeat(64)}`, 250),
      line("$eth", `0x${"3".repeat(64)}`, 200),
    ];

    const summaries = summarizeChannels(rows, new Set([`0x${"1".repeat(64)}`]), [
      "tag:art",
      "cash:BTC",
    ]);

    expect(
      summaries.map((item) => [
        item.id,
        item.count,
        item.unread,
        item.latestAt,
        item.pinned,
      ]),
    ).toEqual([
      ["tag:art", 1, 1, 250, true],
      ["cash:BTC", 0, 0, 0, true],
      ["tag:base", 2, 1, 250, false],
      ["cash:ETH", 2, 1, 200, false],
    ]);
  });
});

describe("pin normalization", () => {
  it("normalizes and caps pinned channels per scope", () => {
    expect(
      normalizePinnedChannels([
        "tag:Base",
        "tag:base",
        "cash:eth",
        ...Array.from({ length: 30 }, (_, index) => `tag:tag${index}`),
      ]),
    ).toHaveLength(24);
  });

  it("normalizes pinned channel scopes and ignores invalid objects", () => {
    const scoped = normalizePinnedChannelsByScope(
      JSON.parse(
        JSON.stringify({
          "base-sepolia:0xab7c8803962c0f2f5bbbe3fa8bf41cd82aa1923c": [
            "tag:base",
            "cash:eth",
          ],
          "__proto__": ["tag:bad"],
          "base:not-address": ["tag:nope"],
        }),
      ),
    );

    expect(scoped).toEqual({
      "base-sepolia:0xab7c8803962c0f2f5bbbe3fa8bf41cd82aa1923c": [
        "tag:base",
        "cash:ETH",
      ],
    });
    expect(normalizePinnedChannelsByScope([])).toEqual({});
    expect(normalizePinnedChannelsByScope(Object.create({ bad: ["tag:bad"] }))).toEqual(
      {},
    );
  });

  it("merges newest pins first and scopes by network and contract", () => {
    expect(mergePinnedChannels(["tag:base"], ["cash:ETH"])).toEqual([
      "cash:ETH",
      "tag:base",
    ]);
    expect(channelScopeKey("base-sepolia", CONTRACT)).toBe(
      "base-sepolia:0xab7c8803962c0f2f5bbbe3fa8bf41cd82aa1923c",
    );
  });
});

describe("filterRowsByChannel", () => {
  it("filters rows by selected local channel", () => {
    const rows = [line("hello #base"), line("hello #other")];

    expect(filterRowsByChannel(rows, "tag:base").map((item) => item.text)).toEqual([
      "hello #base",
    ]);
    expect(lineMatchesChannel(rows[0], "tag:base")).toBe(true);
    expect(lineMatchesChannel(rows[1], "tag:base")).toBe(false);
    expect(channelFromId("cash:eth")?.label).toBe("$ETH");
  });
});
