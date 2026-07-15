import { getAddress, isAddress } from "ethers";

export const MAX_LOCAL_DRAFTS = 12;
export const MAX_DRAFT_TEXT_BYTES = 140;
export const MAX_DRAFT_REFERENCE_TEXT_BYTES = 280;
export const MAX_DRAFT_IMAGE_URI_CHARS = 512;

export type DraftNetworkKey = "base-sepolia" | "base";
export type DraftReferenceMode = "reply" | "echo";

export type LocalDraftReference = {
  mode: DraftReferenceMode;
  networkKey: DraftNetworkKey;
  contractAddress: string;
  author: string;
  index: string;
  createdAt: number;
  contentHash: string;
  text: string;
  imageUri: string;
  imageHash: string;
  refHash: string;
  refKind: number;
  txHash: string;
  blockNumber: number;
};

export type LocalDraft = {
  id: string;
  createdAt: number;
  updatedAt: number;
  networkKey: DraftNetworkKey;
  contractAddress: string;
  text: string;
  imageUri: string;
  imageHash: string;
  reference?: LocalDraftReference;
};

export type DraftInput = {
  id?: string;
  now?: number;
  networkKey: DraftNetworkKey;
  contractAddress?: string;
  text?: string;
  imageUri?: string;
  imageHash?: string;
  reference?: LocalDraftReference;
};

const HEX_32_RE = /^0x[a-fA-F0-9]{64}$/;
const DRAFT_ID_RE = /^draft:[a-z0-9][a-z0-9-]{0,48}$/;
const NETWORK_KEYS = new Set(["base-sepolia", "base"]);

export function makeDraftId(now = Date.now(), nonce = "") {
  const suffix = normalizeDraftIdSuffix(nonce || randomDraftNonce());
  return `draft:${now.toString(36)}${suffix ? `-${suffix}` : ""}`;
}

export function createLocalDraft(input: DraftInput): LocalDraft | undefined {
  const networkKey = normalizeNetworkKey(input.networkKey);
  if (!networkKey) return undefined;
  const text = normalizeDraftText(input.text);
  const imageUri = normalizeDraftImageUri(input.imageUri);
  const imageHash = normalizeHash(input.imageHash, true);
  const reference = normalizeDraftReference(input.reference);
  const hasImagePointer = Boolean(imageUri && !isZeroHash(imageHash));
  if (!text && !hasImagePointer && !reference) return undefined;
  const now = normalizeTimestamp(input.now) || Date.now();
  const id = normalizeDraftId(input.id) || makeDraftId(now);
  return {
    id,
    createdAt: now,
    updatedAt: now,
    networkKey,
    contractAddress: normalizeContractAddress(input.contractAddress),
    text,
    imageUri: hasImagePointer ? imageUri : "",
    imageHash: hasImagePointer ? imageHash : zeroHash(),
    reference,
  };
}

export function normalizeDraftQueue(value: unknown) {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, LocalDraft>();
  value.forEach((item) => {
    const draft = normalizeDraft(item);
    if (!draft) return;
    byId.set(draft.id, draft);
  });
  return [...byId.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt)
    .slice(0, MAX_LOCAL_DRAFTS);
}

export function upsertDraft(queue: readonly LocalDraft[], draft: LocalDraft) {
  return normalizeDraftQueue([
    draft,
    ...queue.filter((item) => item.id !== draft.id),
  ]);
}

export function deleteDraft(queue: readonly LocalDraft[], id: string) {
  const normalized = normalizeDraftId(id);
  return normalizeDraftQueue(
    queue.filter((item) => item.id !== normalized),
  );
}

export function draftMatchesScope(
  draft: LocalDraft,
  networkKey: DraftNetworkKey,
  contractAddress: string,
) {
  if (draft.networkKey !== networkKey) return false;
  if (!draft.contractAddress) return true;
  return (
    isAddress(contractAddress) &&
    draft.contractAddress.toLowerCase() === contractAddress.toLowerCase()
  );
}

export function filterDraftsForScope(
  queue: readonly LocalDraft[],
  networkKey: DraftNetworkKey,
  contractAddress: string,
) {
  return normalizeDraftQueue(queue).filter((draft) =>
    draftMatchesScope(draft, networkKey, contractAddress),
  );
}

export function draftLabel(draft: LocalDraft) {
  const parts = [
    draft.reference ? draft.reference.mode : "",
    draft.text ? trimLabel(draft.text) : "",
    draft.imageUri ? "image" : "",
  ].filter(Boolean);
  return parts.join(" · ") || "empty draft";
}

function normalizeDraft(value: unknown): LocalDraft | undefined {
  if (!isPlainRecord(value)) return undefined;
  const networkKey = normalizeNetworkKey(value.networkKey);
  const id = normalizeDraftId(value.id);
  const createdAt = normalizeTimestamp(value.createdAt);
  const updatedAt = normalizeTimestamp(value.updatedAt);
  if (!networkKey || !id || !createdAt || !updatedAt) return undefined;
  const text = normalizeDraftText(value.text);
  const imageUri = normalizeDraftImageUri(value.imageUri);
  const imageHash = normalizeHash(value.imageHash, true);
  const reference = normalizeDraftReference(value.reference);
  const hasImagePointer = Boolean(imageUri && !isZeroHash(imageHash));
  if (!text && !hasImagePointer && !reference) return undefined;
  return {
    id,
    createdAt,
    updatedAt,
    networkKey,
    contractAddress: normalizeContractAddress(value.contractAddress),
    text,
    imageUri: hasImagePointer ? imageUri : "",
    imageHash: hasImagePointer ? imageHash : zeroHash(),
    reference,
  };
}

export function normalizeDraftReference(
  value: unknown,
): LocalDraftReference | undefined {
  if (!isPlainRecord(value)) return undefined;
  const mode = value.mode;
  const networkKey = normalizeNetworkKey(value.networkKey);
  const contractAddress = normalizeContractAddress(value.contractAddress);
  const author =
    typeof value.author === "string" && isAddress(value.author)
      ? getAddress(value.author)
      : "";
  const index = normalizeIndex(value.index);
  const createdAt = normalizeTimestamp(value.createdAt);
  const blockNumber = normalizeBlockNumber(value.blockNumber);
  const refKind = Number(value.refKind);
  const contentHash = normalizeHash(value.contentHash);
  const imageHash = normalizeHash(value.imageHash);
  const refHash = normalizeHash(value.refHash);
  const txHash = normalizeHash(value.txHash);
  if (
    (mode !== "reply" && mode !== "echo") ||
    !networkKey ||
    !contractAddress ||
    !author ||
    !index ||
    !createdAt ||
    blockNumber === undefined ||
    ![0, 1, 2].includes(refKind) ||
    !contentHash ||
    !imageHash ||
    !refHash ||
    !txHash
  ) {
    return undefined;
  }
  return {
    mode,
    networkKey,
    contractAddress,
    author,
    index,
    createdAt,
    contentHash,
    text: truncateBytes(String(value.text ?? ""), MAX_DRAFT_REFERENCE_TEXT_BYTES),
    imageUri: normalizeDraftImageUri(value.imageUri),
    imageHash,
    refHash,
    refKind,
    txHash,
    blockNumber,
  };
}

function normalizeNetworkKey(value: unknown): DraftNetworkKey | "" {
  return typeof value === "string" && NETWORK_KEYS.has(value)
    ? (value as DraftNetworkKey)
    : "";
}

function normalizeContractAddress(value: unknown) {
  return typeof value === "string" && isAddress(value) ? getAddress(value) : "";
}

function normalizeDraftText(value: unknown) {
  return truncateBytes(String(value ?? "").trim(), MAX_DRAFT_TEXT_BYTES);
}

function normalizeDraftImageUri(value: unknown) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_DRAFT_IMAGE_URI_CHARS) return "";
  return /^(ipfs:\/\/|ar:\/\/)/i.test(trimmed) ? trimmed : "";
}

function normalizeHash(value: unknown, allowEmpty = false) {
  if (typeof value !== "string") return allowEmpty ? zeroHash() : "";
  if (allowEmpty && !value) return zeroHash();
  return HEX_32_RE.test(value) ? value.toLowerCase() : "";
}

function normalizeDraftId(value: unknown) {
  return typeof value === "string" && DRAFT_ID_RE.test(value) ? value : "";
}

function normalizeDraftIdSuffix(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
}

function normalizeTimestamp(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeBlockNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function normalizeIndex(value: unknown) {
  try {
    const parsed = BigInt(String(value ?? ""));
    return parsed >= 0n ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function truncateBytes(value: string, limit: number) {
  const encoder = new TextEncoder();
  if (encoder.encode(value).length <= limit) return value;
  let output = "";
  for (const char of value) {
    const next = output + char;
    if (encoder.encode(next).length > limit) break;
    output = next;
  }
  return output;
}

function trimLabel(value: string) {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > 34 ? `${trimmed.slice(0, 31)}...` : trimmed;
}

function randomDraftNonce() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

function zeroHash() {
  return `0x${"0".repeat(64)}`;
}

function isZeroHash(value: string) {
  return value.toLowerCase() === zeroHash();
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
