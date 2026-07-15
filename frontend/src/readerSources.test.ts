import { describe, expect, it } from "vitest";
import { getAddress } from "ethers";
import {
  MAX_READER_SOURCES,
  deleteReaderSource,
  makeReaderSource,
  normalizeReaderSourceName,
  normalizeReaderSources,
  readerSourceIdFromName,
  serializeReaderSources,
  upsertReaderSource,
} from "./readerSources";

const CONTRACT = "0xab7c8803962c0f2f5bbbe3fa8bf41cd82aa1923c";
const AUTHOR = "0x8fc6e1d2f21bb22b1013d05ecf1f06fd73cdcb34";
const BASE_BUILDERS_ID =
  "source:d036c2b72446a92e3998ece14b95c6724c63899e2a0114d33f1c502f3fddab6d";

function source(overrides: Record<string, unknown> = {}) {
  const made = makeReaderSource({
    name: "Base Builders",
    networkKey: "base-sepolia",
    contractAddress: CONTRACT,
    fromBlock: "123",
    scanScope: "address",
    author: AUTHOR,
    channel: "tag:base",
    mode: "media",
    sort: "oldest",
    updatedAt: 10,
    ...overrides,
  });
  if (!made) throw new Error("test source failed");
  return made;
}

describe("reader source normalization", () => {
  it("normalizes names and ids", () => {
    expect(normalizeReaderSourceName("  Base   Builders  ")).toBe(
      "Base Builders",
    );
    expect(readerSourceIdFromName("Base Builders!")).toBe(
      "source:3173898f247031512ff6e318ca43200a726a739a3099910c486baab0cdd7c5c2",
    );
  });

  it("keeps distinct normalized names when their legacy slugs collide", () => {
    const sources = normalizeReaderSources([
      source({ name: "Ops RPC", updatedAt: 1 }),
      source({ name: "Ops-RPC", updatedAt: 2 }),
    ]);

    expect(sources).toHaveLength(2);
    expect(new Set(sources.map((item) => item.id)).size).toBe(2);
    expect(sources.map((item) => item.name).sort()).toEqual([
      "Ops RPC",
      "Ops-RPC",
    ]);
  });

  it("dedupes exact normalized names", () => {
    const sources = normalizeReaderSources([
      source({ name: "  Ops   RPC  ", updatedAt: 1, fromBlock: "123" }),
      source({ name: "Ops RPC", updatedAt: 2, fromBlock: "456" }),
    ]);

    expect(sources).toHaveLength(1);
    expect(sources[0].name).toBe("Ops RPC");
    expect(sources[0].fromBlock).toBe("456");
  });

  it("rejects unsafe names and invalid public scope", () => {
    expect(normalizeReaderSourceName("\u202ebad")).toBe("");
    expect(normalizeReaderSourceName("x".repeat(33))).toBe("");
    expect(
      makeReaderSource({
        name: "Bad",
        networkKey: "base",
        contractAddress: "bad",
        fromBlock: "0",
        scanScope: "all",
        author: "",
        channel: "",
        mode: "all",
        sort: "newest",
      }),
    ).toBeUndefined();
  });

  it("keeps only public reader state", () => {
    expect(
      makeReaderSource({
        name: "Base Builders",
        networkKey: "base-sepolia",
        contractAddress: CONTRACT,
        fromBlock: "123",
        scanScope: "tracked",
        author: AUTHOR,
        channel: "tag:base",
        mode: "saved",
        sort: "oldest",
        updatedAt: 2.9,
      }),
    ).toEqual({
      id: BASE_BUILDERS_ID,
      name: "Base Builders",
      networkKey: "base-sepolia",
      contractAddress: getAddress(CONTRACT),
      fromBlock: "123",
      scanScope: "all",
      author: "",
      channel: "tag:base",
      mode: "all",
      sort: "oldest",
      updatedAt: 2,
    });
  });

  it("serializes only approved public fields", () => {
    const [serialized] = serializeReaderSources([
      {
        ...source({ updatedAt: 12 }),
        rawUrl: "https://private.example",
        rpcUrl: "https://private.example/rpc",
        proofRpcUrl: "https://private.example/proof",
        wallet: AUTHOR,
      },
    ]);

    expect(serialized).toEqual({
      name: "Base Builders",
      networkKey: "base-sepolia",
      contractAddress: getAddress(CONTRACT),
      fromBlock: "123",
      scanScope: "address",
      author: getAddress(AUTHOR),
      channel: "tag:base",
      mode: "media",
      sort: "oldest",
    });
  });

  it("rebuilds stable ids on reload instead of trusting legacy ids", () => {
    const original = source({ name: "Ops RPC" });
    const [stored] = serializeReaderSources([original]);

    expect(stored).not.toHaveProperty("id");
    const [reloaded] = normalizeReaderSources([
      { ...stored, id: "source:legacy-malformed" },
    ]);
    expect(reloaded.id).toBe(original.id);
    expect(reloaded.id).toMatch(/^source:[0-9a-f]{64}$/);
  });

  it("normalizes, dedupes, sorts, and caps sources", () => {
    const sources = normalizeReaderSources([
      source({ name: "Older", updatedAt: 1 }),
      source({ name: "Newer", updatedAt: 2 }),
      source({ name: "Older", updatedAt: 3, fromBlock: "456" }),
      ...Array.from({ length: 24 }, (_, index) =>
        source({ name: `Item ${index}`, updatedAt: index + 10 }),
      ),
      { name: "__proto__", contractAddress: CONTRACT },
    ]);

    expect(sources).toHaveLength(MAX_READER_SOURCES);
    expect(sources[0].name).toBe("Item 23");
    expect(sources.some((item) => item.name === "Older")).toBe(false);
  });

  it("upserts and deletes by id", () => {
    const updated = upsertReaderSource([source()], source({ fromBlock: "456" }));

    expect(updated).toHaveLength(1);
    expect(updated[0].fromBlock).toBe("456");
    expect(deleteReaderSource(updated, BASE_BUILDERS_ID)).toEqual([]);
  });
});
