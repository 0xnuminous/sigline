import { describe, expect, it } from "vitest";
import {
  MAX_HIGHLIGHT_TERMS,
  matchingHighlightTerms,
  normalizeHighlightTerm,
  normalizeHighlightTerms,
} from "./highlights";

describe("normalizeHighlightTerm", () => {
  it("trims, lowercases, normalizes, and collapses whitespace", () => {
    expect(normalizeHighlightTerm("  Base   BUILDERS  ")).toBe("base builders");
  });

  it("rejects empty, oversized, and control-character terms", () => {
    expect(normalizeHighlightTerm("   ")).toBe("");
    expect(normalizeHighlightTerm("x".repeat(41))).toBe("");
    expect(normalizeHighlightTerm("base\u202ehidden")).toBe("");
  });
});

describe("normalizeHighlightTerms", () => {
  it("dedupes and sorts valid terms", () => {
    expect(
      normalizeHighlightTerms(["Base", "base", "  image post ", false, ""]),
    ).toEqual(["base", "image post"]);
  });

  it("rejects non-arrays and caps restored terms", () => {
    expect(normalizeHighlightTerms({ term: "base" })).toEqual([]);
    expect(
      normalizeHighlightTerms(
        Array.from({ length: MAX_HIGHLIGHT_TERMS + 2 }, (_, index) =>
          `term-${index}`,
        ),
      ),
    ).toHaveLength(MAX_HIGHLIGHT_TERMS);
  });
});

describe("matchingHighlightTerms", () => {
  it("returns normalized terms that appear in the supplied text parts", () => {
    expect(
      matchingHighlightTerms(["base", "question", "missing"], [
        "Base post",
        undefined,
        "question thread",
      ]),
    ).toEqual(["base", "question"]);
  });

  it("normalizes composed and decomposed unicode before matching", () => {
    expect(matchingHighlightTerms(["café"], ["Cafe\u0301 line"])).toEqual([
      "café",
    ]);
  });
});
