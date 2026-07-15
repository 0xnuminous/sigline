import { getAddress, isAddress } from "ethers";
import type { Sigcard, TimelineItem } from "./chain";

export const MAX_MENTIONS_PER_LINE = 12;
export const MAX_MENTION_ALIAS_BYTES = 64;

export type MentionToken =
  | {
      kind: "address";
      token: string;
      label: string;
      address: string;
    }
  | {
      kind: "alias";
      token: string;
      label: string;
    };

export type MentionTarget = {
  address: string;
  aliases: string[];
};

export type MentionSummary = {
  target?: MentionTarget;
  count: number;
  unread: number;
};

const MENTION_RE =
  /(^|[\s([{])@(0[xX][a-fA-F0-9]{40}|[A-Za-z0-9][A-Za-z0-9_.-]{0,63})(?=$|[\s)\]}.,!?;:])/g;

export function parseMentions(text: string): MentionToken[] {
  const seen = new Set<string>();
  const mentions: MentionToken[] = [];
  for (const match of text.matchAll(MENTION_RE)) {
    if (mentions.length >= MAX_MENTIONS_PER_LINE) break;
    const token = match[2];
    const mention = mentionFromToken(token);
    if (!mention) continue;
    const key =
      mention.kind === "address"
        ? `address:${mention.address.toLowerCase()}`
        : `alias:${mention.token}`;
    if (seen.has(key)) continue;
    seen.add(key);
    mentions.push(mention);
  }
  return mentions;
}

export function mentionFromToken(token: string): MentionToken | undefined {
  const normalized = token.normalize("NFKC").trim();
  const addressCandidate = normalized.replace(/^0X/, "0x");
  if (isAddress(addressCandidate)) {
    const address = getAddress(addressCandidate);
    return { kind: "address", token: address.toLowerCase(), label: `@${address}`, address };
  }
  const alias = normalizeMentionAlias(normalized);
  return alias ? { kind: "alias", token: alias, label: `@${alias}` } : undefined;
}

export function normalizeMentionAlias(value: unknown) {
  if (typeof value !== "string") return "";
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  if (
    !normalized ||
    /^0x/i.test(normalized) ||
    !/^[a-z0-9][a-z0-9_.-]{0,63}$/.test(normalized) ||
    new TextEncoder().encode(normalized).length > MAX_MENTION_ALIAS_BYTES
  ) {
    return "";
  }
  return normalized;
}

export function mentionTargetFromAddress(
  address: string,
  sigcards: Record<string, Sigcard> = {},
): MentionTarget | undefined {
  if (!isAddress(address)) return undefined;
  const normalized = getAddress(address);
  const card = sigcards[normalized.toLowerCase()];
  const aliases = new Set<string>();
  const nick = normalizeMentionAlias(card?.nick);
  if (nick) aliases.add(nick);
  return { address: normalized, aliases: [...aliases].sort() };
}

export function lineMentionsTarget(
  item: TimelineItem,
  target: MentionTarget | undefined,
) {
  if (!target) return false;
  const targetAddress = target.address.toLowerCase();
  const aliases = new Set(target.aliases.map((alias) => alias.toLowerCase()));
  return parseMentions(item.text).some((mention) =>
    mention.kind === "address"
      ? mention.address.toLowerCase() === targetAddress
      : aliases.has(mention.token),
  );
}

export function summarizeMentions(
  rows: readonly TimelineItem[],
  target: MentionTarget | undefined,
  readHashes: ReadonlySet<string> = new Set(),
): MentionSummary {
  if (!target) return { count: 0, unread: 0 };
  const matching = rows.filter((item) => lineMentionsTarget(item, target));
  return {
    target,
    count: matching.length,
    unread: matching.filter(
      (item) => !readHashes.has(item.contentHash.toLowerCase()),
    ).length,
  };
}
