import {
  REF_KIND_ECHO,
  REF_KIND_NONE,
  REF_KIND_REPLY,
  TimelineItem,
  ZERO_HASH,
} from "./chain";

export const MAX_DIGEST_ROWS = 40;
const MAX_DIGEST_TEXT_BYTES = 280;

export type FeedDigestOptions = {
  title?: string;
  network: string;
  contract: string;
  scope?: string;
  generatedAt?: string;
  limit?: number;
};

export function serializeFeedDigest(
  rows: readonly TimelineItem[],
  options: FeedDigestOptions,
) {
  const limit = normalizeLimit(options.limit);
  const shown = rows.slice(0, limit);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const header = [
    options.title?.trim() || "Sigline feed digest",
    `generated: ${generatedAt}`,
    `network: ${options.network || "unknown"}`,
    `contract: ${options.contract || "not set"}`,
    `scope: ${options.scope?.trim() || "visible feed"}`,
    `rows: ${shown.length}${rows.length > shown.length ? `/${rows.length}` : ""}`,
  ];
  const body = shown.flatMap((item, index) => digestLine(item, index));
  const footer =
    rows.length > shown.length
      ? [``, `truncated: ${rows.length - shown.length} row${rows.length - shown.length === 1 ? "" : "s"} omitted`]
      : [];
  return [...header, "", ...body, ...footer].join("\n");
}

function digestLine(item: TimelineItem, index: number) {
  const ref = refLabel(item);
  const media = mediaLabel(item);
  const text = digestText(item);
  return [
    `${index + 1}. ${short(item.author)} #${item.index.toString()} block ${item.blockNumber}`,
    `   tx: ${short(item.txHash)} line: ${short(item.contentHash)}`,
    `   author: ${item.author}`,
    `   ref: ${ref}`,
    `   media: ${media}`,
    `   text: ${text}`,
  ];
}

function digestText(item: TimelineItem) {
  const trimmed = item.text.trim();
  if (trimmed) return truncateBytes(trimmed, MAX_DIGEST_TEXT_BYTES);
  if (item.imageUri) return "[media only]";
  if (item.refKind !== REF_KIND_NONE) return "[reference only]";
  return "[empty]";
}

function refLabel(item: TimelineItem) {
  if (item.refKind === REF_KIND_NONE || item.refHash.toLowerCase() === ZERO_HASH) {
    return "none";
  }
  const kind =
    item.refKind === REF_KIND_REPLY
      ? "answer"
      : item.refKind === REF_KIND_ECHO
        ? "echo"
        : `kind ${item.refKind}`;
  return `${kind} ${short(item.refHash)}`;
}

function mediaLabel(item: TimelineItem) {
  if (!item.imageUri) return "none";
  const hash = item.imageHash.toLowerCase() === ZERO_HASH ? "unhashed" : short(item.imageHash);
  return `${hash} ${truncateBytes(item.imageUri, 80)}`;
}

function short(value: string) {
  return value.length <= 18 ? value : `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function normalizeLimit(value: number | undefined) {
  if (!Number.isFinite(value)) return MAX_DIGEST_ROWS;
  return Math.max(1, Math.min(MAX_DIGEST_ROWS, Math.floor(value || MAX_DIGEST_ROWS)));
}

function truncateBytes(value: string, maxBytes: number) {
  const encoder = new TextEncoder();
  if (encoder.encode(value).length <= maxBytes) return value;
  let output = "";
  for (const char of value) {
    const next = `${output}${char}`;
    if (encoder.encode(`${next}...`).length > maxBytes) break;
    output = next;
  }
  return `${output}...`;
}
