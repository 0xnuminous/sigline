import { isAddress } from "ethers";
import type { NetworkKey, TimelineItem } from "./chain";

export const MAX_CHANNELS_PER_LINE = 8;
export const MAX_CHANNEL_TOKEN_BYTES = 32;
export const MAX_CASHTAG_TOKEN_BYTES = 12;
export const MAX_CHANNEL_SUMMARY = 24;
export const MAX_PINNED_CHANNELS_PER_SCOPE = 24;
export const MAX_PINNED_CHANNEL_SCOPES = 10;

export type ChannelKind = "hashtag" | "cashtag";
export type ChannelId = `tag:${string}` | `cash:${string}`;

export type LineChannel = {
  id: ChannelId;
  kind: ChannelKind;
  token: string;
  label: string;
};

export type ChannelSummary = LineChannel & {
  count: number;
  unread: number;
  latestAt: number;
  lineHashes: string[];
  pinned: boolean;
};

const CHANNEL_RE = /(^|[\s([{])([#$][A-Za-z][A-Za-z0-9_]{0,31})(?=$|[\s)\]}.,!?;:])/g;
const SCOPE_RE = /^(base|base-sepolia):0x[a-f0-9]{40}$/;

export function parseLineChannels(text: string): LineChannel[] {
  const seen = new Set<ChannelId>();
  const channels: LineChannel[] = [];
  for (const match of text.matchAll(CHANNEL_RE)) {
    if (channels.length >= MAX_CHANNELS_PER_LINE) break;
    const raw = match[2];
    const token = normalizeChannelToken(raw);
    if (!token) continue;
    const parsed = toLineChannel(token);
    if (!parsed || seen.has(parsed.id)) continue;
    seen.add(parsed.id);
    channels.push(parsed);
  }
  return channels;
}

export function summarizeChannels(
  rows: TimelineItem[],
  readHashes: ReadonlySet<string> = new Set(),
  pinnedChannels: readonly ChannelId[] = [],
  limit = MAX_CHANNEL_SUMMARY,
): ChannelSummary[] {
  const pinnedSet = new Set(normalizePinnedChannels(pinnedChannels));
  const summaries = new Map<ChannelId, ChannelSummary>();
  rows.forEach((item) => {
    parseLineChannels(item.text).forEach((channel) => {
      const current = summaries.get(channel.id);
      const lineHash = item.contentHash.toLowerCase();
      summaries.set(channel.id, {
        ...channel,
        count: (current?.count ?? 0) + 1,
        unread:
          (current?.unread ?? 0) + (readHashes.has(lineHash) ? 0 : 1),
        latestAt: Math.max(current?.latestAt ?? 0, item.createdAt),
        lineHashes: [...(current?.lineHashes ?? []), lineHash],
        pinned: pinnedSet.has(channel.id),
      });
    });
  });
  pinnedSet.forEach((id) => {
    if (summaries.has(id)) return;
    const channel = channelFromId(id);
    if (!channel) return;
    summaries.set(id, {
      ...channel,
      count: 0,
      unread: 0,
      latestAt: 0,
      lineHashes: [],
      pinned: true,
    });
  });
  return [...summaries.values()]
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        b.count - a.count ||
        b.latestAt - a.latestAt ||
        a.id.localeCompare(b.id),
    )
    .slice(0, limit);
}

export function filterRowsByChannel(
  rows: TimelineItem[],
  selectedChannel: ChannelId | "",
) {
  if (!selectedChannel) return rows;
  return rows.filter((item) =>
    parseLineChannels(item.text).some((channel) => channel.id === selectedChannel),
  );
}

export function lineMatchesChannel(
  item: TimelineItem,
  selectedChannel: ChannelId | "",
) {
  return filterRowsByChannel([item], selectedChannel).length === 1;
}

export function normalizePinnedChannels(value: unknown): ChannelId[] {
  const items = Array.isArray(value) ? value : [];
  const seen = new Set<ChannelId>();
  items.forEach((item) => {
    const channel = channelFromId(String(item));
    if (channel) seen.add(channel.id);
  });
  return [...seen].slice(0, MAX_PINNED_CHANNELS_PER_SCOPE);
}

export function mergePinnedChannels(
  current: ChannelId[],
  additions: ChannelId[],
) {
  return normalizePinnedChannels([...additions, ...current]);
}

export function normalizePinnedChannelsByScope(value: unknown) {
  if (!isPlainRecord(value)) return {};
  const entries = Object.entries(value)
    .filter(([key]) => SCOPE_RE.test(key))
    .map(([key, pins]) => [key, normalizePinnedChannels(pins)] as const)
    .filter(([, pins]) => pins.length > 0)
    .slice(0, MAX_PINNED_CHANNEL_SCOPES);
  return Object.fromEntries(entries) as Record<string, ChannelId[]>;
}

export function channelScopeKey(
  networkKey: NetworkKey,
  contractAddress: string,
) {
  return isAddress(contractAddress)
    ? `${networkKey}:${contractAddress.toLowerCase()}`
    : "";
}

export function channelFromId(id: string): LineChannel | undefined {
  const normalized = id.trim();
  if (normalized.startsWith("tag:")) {
    const token = normalized.slice(4);
    if (!isValidHashtagToken(token)) return undefined;
    return { id: `tag:${token}`, kind: "hashtag", token, label: `#${token}` };
  }
  if (normalized.startsWith("cash:")) {
    const token = normalized.slice(5).toUpperCase();
    if (!isValidCashtagToken(token)) return undefined;
    return { id: `cash:${token}`, kind: "cashtag", token, label: `$${token}` };
  }
  const token = normalizeChannelToken(normalized);
  return token ? toLineChannel(token) : undefined;
}

function normalizeChannelToken(value: unknown) {
  if (typeof value !== "string") return "";
  const normalized = value.normalize("NFKC").trim();
  if (normalized.startsWith("#")) {
    const token = normalized.slice(1).toLowerCase();
    if (!isValidHashtagToken(token)) return "";
    return `#${token}`;
  }
  if (normalized.startsWith("$")) {
    const token = normalized.slice(1).toUpperCase();
    if (!isValidCashtagToken(token)) return "";
    return `$${token}`;
  }
  return "";
}

function toLineChannel(token: string): LineChannel | undefined {
  if (token.startsWith("#")) {
    const value = token.slice(1);
    if (!isValidHashtagToken(value)) return undefined;
    return { id: `tag:${value}`, kind: "hashtag", token: value, label: token };
  }
  if (token.startsWith("$")) {
    const value = token.slice(1);
    if (!isValidCashtagToken(value)) return undefined;
    return { id: `cash:${value}`, kind: "cashtag", token: value, label: token };
  }
  return undefined;
}

function isValidHashtagToken(token: string) {
  return (
    /^[a-z][a-z0-9_]{1,31}$/.test(token) &&
    new TextEncoder().encode(token).length <= MAX_CHANNEL_TOKEN_BYTES
  );
}

function isValidCashtagToken(token: string) {
  return (
    /^[A-Z][A-Z0-9]{1,11}$/.test(token) &&
    new TextEncoder().encode(token).length <= MAX_CASHTAG_TOKEN_BYTES
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
