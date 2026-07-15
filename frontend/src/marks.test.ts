import { describe, expect, it } from "vitest";
import {
  MAX_LINE_MARKS,
  getLineMark,
  nextLineMark,
  normalizeLineMark,
  normalizeLineMarks,
  setLineMark,
} from "./marks";

const HASH_A = `0x${"a".repeat(64)}`;
const HASH_A_UPPER = `0x${HASH_A.slice(2).toUpperCase()}`;
const HASH_B = `0x${"b".repeat(64)}`;

describe("normalizeLineMark", () => {
  it("accepts only the fixed local mark enum", () => {
    expect(normalizeLineMark("important")).toBe("important");
    expect(normalizeLineMark("like")).toBe("");
    expect(normalizeLineMark("__proto__")).toBe("");
  });

  it("migrates the legacy signal mark to important", () => {
    expect(normalizeLineMark("signal")).toBe("important");
  });
});

describe("normalizeLineMarks", () => {
  it("keeps valid marks by lower-case content hash", () => {
    expect(
      normalizeLineMarks({
        [HASH_A_UPPER]: "signal",
        [HASH_B]: "like",
        "0xdead": "verify",
      }),
    ).toEqual({
      [HASH_A]: "important",
    });
  });

  it("rejects inherited records and caps mark count", () => {
    const inherited = Object.create({ [HASH_A]: "important" });
    expect(normalizeLineMarks(inherited)).toEqual({});

    const marks = Object.fromEntries(
      Array.from({ length: MAX_LINE_MARKS + 1 }, (_, index) => [
        `0x${(index + 1).toString(16).padStart(64, "0")}`,
        "verify",
      ]),
    );
    expect(Object.keys(normalizeLineMarks(marks))).toHaveLength(MAX_LINE_MARKS);
  });
});

describe("setLineMark", () => {
  it("sets, reads, clears, and does not mutate input marks", () => {
    const marks = {};
    const withMark = setLineMark(marks, HASH_A_UPPER, "question");

    expect(marks).toEqual({});
    expect(getLineMark(withMark, HASH_A)).toBe("question");
    expect(setLineMark(withMark, HASH_A, "")).toEqual({});
  });

  it("keeps current marks when the content hash is invalid", () => {
    const marks = setLineMark({}, HASH_A, "later");

    expect(setLineMark(marks, "not a hash", "important")).toEqual(marks);
  });
});

describe("nextLineMark", () => {
  it("cycles through marks and back to empty", () => {
    expect([
      nextLineMark(""),
      nextLineMark("important"),
      nextLineMark("question"),
      nextLineMark("verify"),
      nextLineMark("later"),
    ]).toEqual(["important", "question", "verify", "later", ""]);
  });
});
