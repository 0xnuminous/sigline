import { getAddress, id, isAddress } from "ethers";
import { channelFromId, type ChannelId } from "./channels";
import type { NetworkKey } from "./chain";
import type { FeedSort } from "./feed";

export const MAX_READER_SOURCES = 16;
export const MAX_READER_SOURCE_NAME_BYTES = 32;

export type ReaderSourceMode = "all" | "media" | "refs";
export type ReaderSourceScope = "all" | "address";

export type ReaderSource = {
  id: `source:${string}`;
  name: string;
  networkKey: NetworkKey;
  contractAddress: string;
  fromBlock: string;
  scanScope: ReaderSourceScope;
  author: string;
  channel: ChannelId | "";
  mode: ReaderSourceMode;
  sort: FeedSort;
  updatedAt: number;
};

export type StoredReaderSource = Pick<
  ReaderSource,
  | "name"
  | "networkKey"
  | "contractAddress"
  | "fromBlock"
  | "scanScope"
  | "author"
  | "channel"
  | "mode"
  | "sort"
>;

export type ReaderSourceInput = {
  name: string;
  networkKey: NetworkKey;
  contractAddress: string;
  fromBlock: string;
  scanScope: string;
  author: string;
  channel: ChannelId | "";
  mode: string;
  sort: FeedSort;
  updatedAt?: number;
};

export function normalizeReaderSourceName(value: unknown) {
  if (typeof value !== "string") return "";
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (
    !normalized ||
    hasUnsafeSourceChar(normalized) ||
    new TextEncoder().encode(normalized).length > MAX_READER_SOURCE_NAME_BYTES
  ) {
    return "";
  }
  return normalized;
}

export function readerSourceIdFromName(value: string): ReaderSource["id"] | "" {
  const name = normalizeReaderSourceName(value);
  if (!name) return "";
  return `source:${id(name).slice(2)}`;
}

export function makeReaderSource(
  input: ReaderSourceInput,
): ReaderSource | undefined {
  const name = normalizeReaderSourceName(input.name);
  const id = readerSourceIdFromName(name);
  if (!name || !id || !isNetworkKey(input.networkKey)) return undefined;
  if (!isAddress(input.contractAddress)) return undefined;
  const author =
    input.scanScope === "address" && isAddress(input.author)
      ? getAddress(input.author)
      : "";
  const scanScope: ReaderSourceScope = author ? "address" : "all";
  return {
    id,
    name,
    networkKey: input.networkKey,
    contractAddress: getAddress(input.contractAddress),
    fromBlock: normalizeSourceBlock(input.fromBlock),
    scanScope,
    author,
    channel: input.channel ? (channelFromId(input.channel)?.id ?? "") : "",
    mode: normalizeSourceMode(input.mode),
    sort: input.sort === "oldest" ? "oldest" : "newest",
    updatedAt: normalizeSourceTime(input.updatedAt),
  };
}

export function normalizeReaderSource(value: unknown): ReaderSource | undefined {
  if (!isPlainRecord(value)) return undefined;
  return makeReaderSource({
    name: typeof value.name === "string" ? value.name : "",
    networkKey: value.networkKey as NetworkKey,
    contractAddress: typeof value.contractAddress === "string" ? value.contractAddress : "",
    fromBlock: typeof value.fromBlock === "string" ? value.fromBlock : "",
    scanScope: typeof value.scanScope === "string" ? value.scanScope : "all",
    author: typeof value.author === "string" ? value.author : "",
    channel: typeof value.channel === "string" ? (value.channel as ChannelId) : "",
    mode: typeof value.mode === "string" ? value.mode : "all",
    sort: value.sort === "oldest" ? "oldest" : "newest",
    updatedAt:
      typeof value.updatedAt === "number" ? value.updatedAt : undefined,
  });
}

export function normalizeReaderSources(value: unknown) {
  if (!Array.isArray(value)) return [];
  const byId = new Map<ReaderSource["id"], ReaderSource>();
  value.forEach((item) => {
    const source = normalizeReaderSource(item);
    if (!source) return;
    const current = byId.get(source.id);
    if (!current || source.updatedAt >= current.updatedAt) {
      byId.set(source.id, source);
    }
  });
  return [...byId.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name))
    .slice(0, MAX_READER_SOURCES);
}

export function serializeReaderSource(source: ReaderSource): StoredReaderSource {
  return {
    name: source.name,
    networkKey: source.networkKey,
    contractAddress: source.contractAddress,
    fromBlock: source.fromBlock,
    scanScope: source.scanScope,
    author: source.author,
    channel: source.channel,
    mode: source.mode,
    sort: source.sort,
  };
}

export function serializeReaderSources(value: unknown) {
  return normalizeReaderSources(value).map(serializeReaderSource);
}

export function upsertReaderSource(
  sources: readonly ReaderSource[],
  source: ReaderSource,
) {
  return normalizeReaderSources([
    source,
    ...sources.filter((item) => item.id !== source.id),
  ]);
}

export function deleteReaderSource(
  sources: readonly ReaderSource[],
  sourceId: ReaderSource["id"],
) {
  return normalizeReaderSources(sources).filter(
    (source) => source.id !== sourceId,
  );
}

function normalizeSourceBlock(value: unknown) {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return /^\d{1,16}$/.test(normalized) ? normalized : "";
}

function normalizeSourceMode(value: string): ReaderSourceMode {
  return value === "media" || value === "refs" ? value : "all";
}

function normalizeSourceTime(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

function isNetworkKey(value: unknown): value is NetworkKey {
  return value === "base" || value === "base-sepolia";
}

function hasUnsafeSourceChar(value: string) {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (
      code <= 0x1f ||
      (code >= 0x7f && code <= 0x9f) ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    ) {
      return true;
    }
  }
  return false;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
