import { describe, expect, it } from "vitest";
import {
  MAX_READER_LENSES_PER_SCOPE,
  deleteReaderLens,
  normalizeReaderLens,
  normalizeReaderLensName,
  normalizeReaderLensQuery,
  normalizeReaderLenses,
  normalizeReaderLensesByScope,
  readerLensIdFromName,
  upsertReaderLens,
  type ReaderLens,
} from "./lenses";

const CONTRACT = "0x0000000000000000000000000000000000000002";
const SCOPE = `base-sepolia:${CONTRACT}`;

function lens(overrides: Partial<ReaderLens> = {}): ReaderLens {
  return {
    id: "lens:unread-builders",
    name: "Unread Builders",
    query: "base builders",
    mode: "unread",
    channel: "tag:base",
    circle: "circle:builders",
    sort: "newest",
    showMuted: false,
    updatedAt: 10,
    ...overrides,
  };
}

describe("reader lens normalization", () => {
  it("normalizes names, queries, and ids", () => {
    expect(normalizeReaderLensName("  Base   Builders  ")).toBe("Base Builders");
    expect(normalizeReaderLensQuery("  #Base   0xabc  ")).toBe("#Base 0xabc");
    expect(readerLensIdFromName("Unread Builders!")).toBe(
      "lens:unread-builders",
    );
  });

  it("rejects unsafe or oversized names and queries", () => {
    expect(normalizeReaderLensName("\u202ebad")).toBe("");
    expect(normalizeReaderLensName("x".repeat(33))).toBe("");
    expect(normalizeReaderLensQuery("\u202ebad")).toBe("");
    expect(normalizeReaderLensQuery("x".repeat(97))).toBe("");
  });

  it("keeps only valid local filter fields", () => {
    expect(
      normalizeReaderLens({
        id: "lens:Unread Builders",
        name: "Unread Builders",
        query: "base",
        mode: "needs-check",
        channel: "#Base",
        circle: "circle:builders",
        sort: "oldest",
        showMuted: true,
        updatedAt: 12.9,
        ignored: "drop",
      }),
    ).toEqual({
      id: "lens:unread-builders",
      name: "Unread Builders",
      query: "base",
      mode: "needs-check",
      channel: "tag:base",
      circle: "circle:builders",
      sort: "oldest",
      showMuted: true,
      updatedAt: 12,
    });
  });

  it("dedupes, sorts, and caps lenses", () => {
    const restored = normalizeReaderLenses([
      lens({ name: "Older", updatedAt: 1 }),
      lens({ name: "Newer", updatedAt: 2 }),
      ...Array.from({ length: MAX_READER_LENSES_PER_SCOPE + 4 }, (_, index) =>
        lens({
          id: `lens:item-${index}`,
          name: `Item ${index}`,
          updatedAt: 100 - index,
        }),
      ),
    ]);

    expect(restored).toHaveLength(MAX_READER_LENSES_PER_SCOPE);
    expect(restored[0].name).toBe("Item 0");
  });

  it("normalizes lenses by contract scope", () => {
    expect(
      normalizeReaderLensesByScope({
        [SCOPE]: [lens()],
        ["__proto__"]: [lens({ name: "Bad" })],
        "base:0xdead": [lens({ name: "Bad" })],
      }),
    ).toEqual({
      [SCOPE]: [lens()],
    });
  });

  it("upserts and deletes lenses by id", () => {
    const updated = upsertReaderLens([lens()], lens({ query: "updated" }));

    expect(updated).toHaveLength(1);
    expect(updated[0].query).toBe("updated");
    expect(deleteReaderLens(updated, "lens:unread-builders")).toEqual([]);
  });
});
