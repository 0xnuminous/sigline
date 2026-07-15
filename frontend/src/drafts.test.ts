import { afterEach, describe, expect, it, vi } from "vitest";
import { getAddress } from "ethers";
import {
  MAX_LOCAL_DRAFTS,
  createLocalDraft,
  deleteDraft,
  draftLabel,
  filterDraftsForScope,
  makeDraftId,
  normalizeDraftQueue,
  upsertDraft,
} from "./drafts";
import type { LocalDraftReference } from "./drafts";

const AUTHOR = "0x8fc6e1d2f21bb22b1013d05ecf1f06fd73cdcb34";
const CONTRACT = "0x0000000000000000000000000000000000000002";
const OTHER_CONTRACT = "0x0000000000000000000000000000000000000003";
const HASH_A = `0x${"a".repeat(64)}`;
const HASH_B = `0x${"b".repeat(64)}`;
const ZERO_HASH = `0x${"0".repeat(64)}`;

afterEach(() => {
  vi.restoreAllMocks();
});

function reference(overrides: Record<string, unknown> = {}): LocalDraftReference {
  return {
    mode: "reply" as const,
    networkKey: "base-sepolia" as const,
    contractAddress: CONTRACT,
    author: AUTHOR,
    index: "2",
    createdAt: 1842041,
    contentHash: HASH_A,
    text: "parent line",
    imageUri: "",
    imageHash: ZERO_HASH,
    refHash: ZERO_HASH,
    refKind: 0,
    txHash: HASH_B,
    blockNumber: 1842041,
    ...overrides,
  } as LocalDraftReference;
}

describe("draft ids", () => {
  it("creates deterministic safe ids when given a nonce", () => {
    expect(makeDraftId(1_700_000_000_000, "Hello World!")).toBe(
      "draft:loyw3v28-hello-world",
    );
  });
});

describe("createLocalDraft", () => {
  it("keeps text-only, image-only pointer, and reference-only drafts", () => {
    expect(
      createLocalDraft({
        now: 1,
        networkKey: "base-sepolia",
        contractAddress: CONTRACT,
        text: "hello",
      }),
    ).toMatchObject({ text: "hello", imageUri: "", imageHash: ZERO_HASH });

    expect(
      createLocalDraft({
        now: 2,
        networkKey: "base-sepolia",
        imageUri: "ipfs://bafyimage",
        imageHash: HASH_A,
      }),
    ).toMatchObject({ text: "", imageUri: "ipfs://bafyimage", imageHash: HASH_A });

    expect(
      createLocalDraft({
        now: 3,
        networkKey: "base-sepolia",
        reference: reference(),
      })?.reference,
    ).toMatchObject({ mode: "reply", author: getAddress(AUTHOR) });
  });

  it("does not persist raw image bytes, data urls, or uri without a real hash", () => {
    expect(
      createLocalDraft({
        now: 1,
        networkKey: "base-sepolia",
        imageUri: "data:image/png;base64,abc",
        imageHash: HASH_A,
      }),
    ).toBeUndefined();

    expect(
      createLocalDraft({
        now: 1,
        networkKey: "base-sepolia",
        imageUri: "ipfs://bafyimage",
        imageHash: ZERO_HASH,
      }),
    ).toBeUndefined();
  });
});

describe("normalizeDraftQueue", () => {
  it("drops malformed items and inherited payloads", () => {
    const queue = normalizeDraftQueue(
      JSON.parse(
        JSON.stringify([
          {
            id: "draft:one",
            createdAt: 1,
            updatedAt: 2,
            networkKey: "base-sepolia",
            contractAddress: CONTRACT,
            text: "hello",
            file: "base64 bytes ignored",
          },
          {
            id: "draft:bad",
            createdAt: 1,
            updatedAt: 2,
            networkKey: "__proto__",
            text: "bad",
          },
        ]),
      ),
    );

    expect(queue).toEqual([
      {
        id: "draft:one",
        createdAt: 1,
        updatedAt: 2,
        networkKey: "base-sepolia",
        contractAddress: CONTRACT,
        text: "hello",
        imageUri: "",
        imageHash: ZERO_HASH,
      },
    ]);
    expect(normalizeDraftQueue(Object.create({ bad: [] }))).toEqual([]);
  });

  it("dedupes by id and caps newest first", () => {
    const queue = normalizeDraftQueue(
      Array.from({ length: MAX_LOCAL_DRAFTS + 5 }, (_, index) => ({
        id: `draft:item-${index}`,
        createdAt: index + 1,
        updatedAt: index + 1,
        networkKey: "base-sepolia",
        text: `draft ${index}`,
      })),
    );

    expect(queue).toHaveLength(MAX_LOCAL_DRAFTS);
    expect(queue[0].text).toBe(`draft ${MAX_LOCAL_DRAFTS + 4}`);
  });
});

describe("draft queue updates and scope filters", () => {
  it("upserts, deletes, labels, and filters by scope", () => {
    vi.spyOn(Date, "now").mockReturnValue(10);
    const draft = createLocalDraft({
      id: "draft:one",
      now: 10,
      networkKey: "base-sepolia",
      contractAddress: CONTRACT,
      text: "hello world",
    })!;
    const other = createLocalDraft({
      id: "draft:two",
      now: 11,
      networkKey: "base-sepolia",
      contractAddress: OTHER_CONTRACT,
      reference: reference({ contractAddress: OTHER_CONTRACT }),
    })!;

    const queue = upsertDraft([draft], other);
    expect(draftLabel(other)).toBe("reply");
    expect(filterDraftsForScope(queue, "base-sepolia", CONTRACT)).toEqual([draft]);
    expect(deleteDraft(queue, "draft:one")).toEqual([other]);
  });
});
