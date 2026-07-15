import { describe, expect, it } from "vitest";
import { getAddress } from "ethers";
import { REF_KIND_NONE, TimelineItem, ZERO_HASH } from "./chain";
import {
  MAX_CIRCLE_MEMBERS,
  MAX_CIRCLES_PER_SCOPE,
  circleIdFromName,
  circleMemberSet,
  circleScopeKey,
  deleteCircle,
  filterRowsByCircle,
  normalizeCircleMembers,
  normalizeCircleName,
  normalizeCircles,
  normalizeCirclesByScope,
  removeAddressFromCircles,
  summarizeCircles,
  toggleCircleMember,
  upsertCircle,
} from "./circles";

const AUTHOR_A = "0x8fc6e1d2f21bb22b1013d05ecf1f06fd73cdcb34";
const AUTHOR_B = "0xab7c8803962c0f2f5bbbe3fa8bf41cd82aa1923c";
const AUTHOR_C = "0x0000000000000000000000000000000000000001";
const CONTRACT = "0x0000000000000000000000000000000000000002";

function line(
  author: string,
  contentHash = `0x${"a".repeat(64)}`,
  createdAt = 100,
): TimelineItem {
  return {
    id: contentHash,
    author,
    index: 0n,
    createdAt,
    contentHash,
    text: "hello #base",
    imageUri: "",
    imageHash: ZERO_HASH,
    refHash: ZERO_HASH,
    refKind: REF_KIND_NONE,
    txHash: `0x${"b".repeat(64)}`,
    blockNumber: 1,
  };
}

describe("circle normalization", () => {
  it("normalizes names and stable ids", () => {
    expect(normalizeCircleName("  Close   Friends ")).toBe("Close Friends");
    expect(circleIdFromName("Close Friends")).toBe("circle:close-friends");
    expect(normalizeCircleName("<script>")).toBe("");
    expect(normalizeCircleName("x".repeat(40))).toBe("");
  });

  it("dedupes, checksums, and caps members", () => {
    const many = Array.from(
      { length: MAX_CIRCLE_MEMBERS + 4 },
      (_, index) => `0x${(index + 1).toString(16).padStart(40, "0")}`,
    );

    expect(
      normalizeCircleMembers([AUTHOR_A.toUpperCase(), AUTHOR_A, "nope", ...many]),
    ).toHaveLength(MAX_CIRCLE_MEMBERS);
  });

  it("normalizes scoped circles and rejects inherited or invalid records", () => {
    const scoped = normalizeCirclesByScope(
      JSON.parse(
        JSON.stringify({
          "base-sepolia:0x0000000000000000000000000000000000000002": [
            {
              id: "circle:close",
              name: "Close",
              addresses: [AUTHOR_A, AUTHOR_A.toUpperCase(), "bad"],
            },
            {
              name: "Close",
              addresses: [AUTHOR_B],
            },
            { name: "<bad>", addresses: [AUTHOR_C] },
          ],
          "__proto__": [{ name: "Polluted", addresses: [AUTHOR_C] }],
          "base:not-address": [{ name: "Bad", addresses: [AUTHOR_C] }],
        }),
      ),
    );

    expect(scoped).toEqual({
      "base-sepolia:0x0000000000000000000000000000000000000002": [
        {
          id: "circle:close",
          name: "Close",
          addresses: [getAddress(AUTHOR_A), getAddress(AUTHOR_B)],
        },
      ],
    });
    expect(normalizeCirclesByScope(Object.create({ bad: [] }))).toEqual({});
    expect(normalizeCircles(Array.from({ length: 20 }, (_, index) => ({
      name: `Circle ${index}`,
      addresses: [AUTHOR_A],
    })))).toHaveLength(MAX_CIRCLES_PER_SCOPE);
  });

  it("scopes by network and contract", () => {
    expect(circleScopeKey("base-sepolia", CONTRACT)).toBe(
      "base-sepolia:0x0000000000000000000000000000000000000002",
    );
    expect(circleScopeKey("base", "bad")).toBe("");
  });
});

describe("circle updates and filtering", () => {
  it("upserts, toggles, deletes, and removes members", () => {
    let circles = upsertCircle([], "Close Friends", [AUTHOR_A]);
    circles = toggleCircleMember(circles, "circle:close-friends", AUTHOR_B);
    expect(circleMemberSet(circles, "circle:close-friends")).toEqual(
      new Set([AUTHOR_A.toLowerCase(), AUTHOR_B.toLowerCase()]),
    );

    circles = toggleCircleMember(circles, "circle:close-friends", AUTHOR_A);
    expect(circleMemberSet(circles, "circle:close-friends")).toEqual(
      new Set([AUTHOR_B.toLowerCase()]),
    );

    circles = removeAddressFromCircles(circles, AUTHOR_B);
    expect(circles[0].addresses).toEqual([]);

    expect(deleteCircle(circles, "circle:close-friends")).toEqual([]);
  });

  it("filters rows and summarizes visible/read state without implying trust", () => {
    const circles = upsertCircle([], "Builders", [AUTHOR_A, AUTHOR_C]);
    const rows = [
      line(AUTHOR_A, `0x${"1".repeat(64)}`, 200),
      line(AUTHOR_B, `0x${"2".repeat(64)}`, 250),
      line(AUTHOR_C, `0x${"3".repeat(64)}`, 100),
    ];

    expect(
      filterRowsByCircle(rows, circles, "circle:builders").map(
        (item) => item.author,
      ),
    ).toEqual([AUTHOR_A, AUTHOR_C]);
    expect(filterRowsByCircle(rows, circles, "").length).toBe(3);

    expect(
      summarizeCircles(rows, circles, new Set([`0x${"1".repeat(64)}`]))[0],
    ).toMatchObject({
      id: "circle:builders",
      visibleCount: 2,
      unread: 1,
      latestAt: 200,
    });
  });
});
