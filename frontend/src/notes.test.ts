import { describe, expect, it } from "vitest";
import {
  MAX_LINE_NOTES,
  getLineNote,
  normalizeLineNote,
  normalizeLineNotes,
  setLineNote,
} from "./notes";

const HASH_A = `0x${"a".repeat(64)}`;
const HASH_B = `0x${"b".repeat(64)}`;
const HASH_A_UPPER = `0x${HASH_A.slice(2).toUpperCase()}`;

describe("normalizeLineNote", () => {
  it("trims, normalizes, and collapses whitespace", () => {
    expect(normalizeLineNote("  follow   up\nlater  ")).toBe("follow up later");
  });

  it("rejects empty, oversized, and control-character notes", () => {
    expect(normalizeLineNote("   ")).toBe("");
    expect(normalizeLineNote("x".repeat(281))).toBe("");
    expect(normalizeLineNote("note\u202ebad")).toBe("");
  });
});

describe("normalizeLineNotes", () => {
  it("keeps valid note records by lower-case content hash", () => {
    expect(
      normalizeLineNotes({
        [HASH_A_UPPER]: "Alpha",
        [HASH_B]: "",
        "0xdead": "drop",
      }),
    ).toEqual({
      [HASH_A]: "Alpha",
    });
  });

  it("rejects inherited records and caps note count", () => {
    const inherited = Object.create({ [HASH_A]: "bad" });
    expect(normalizeLineNotes(inherited)).toEqual({});

    const notes = Object.fromEntries(
      Array.from({ length: MAX_LINE_NOTES + 1 }, (_, index) => [
        `0x${(index + 1).toString(16).padStart(64, "0")}`,
        `note ${index}`,
      ]),
    );
    expect(Object.keys(normalizeLineNotes(notes))).toHaveLength(MAX_LINE_NOTES);
  });
});

describe("setLineNote", () => {
  it("sets, reads, and clears notes without mutating the input", () => {
    const notes = {};
    const withNote = setLineNote(notes, HASH_A_UPPER, "Alpha");

    expect(notes).toEqual({});
    expect(getLineNote(withNote, HASH_A)).toBe("Alpha");
    expect(setLineNote(withNote, HASH_A, "")).toEqual({});
  });

  it("keeps current notes when the content hash is invalid", () => {
    const notes = setLineNote({}, HASH_A, "Alpha");

    expect(setLineNote(notes, "not a hash", "Mallory")).toEqual(notes);
  });
});
