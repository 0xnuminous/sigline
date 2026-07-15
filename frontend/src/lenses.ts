import { isAddress } from "ethers";
import { channelFromId, type ChannelId } from "./channels";
import type { NetworkKey } from "./chain";
import type { FeedSort } from "./feed";

export const MAX_READER_LENSES_PER_SCOPE = 12;
export const MAX_READER_LENS_SCOPES = 10;
export const MAX_READER_LENS_NAME_BYTES = 32;
export const MAX_READER_LENS_QUERY_BYTES = 96;

export type ReaderLensMode =
  | "all"
  | "unread"
  | "mentions"
  | "media"
  | "refs"
  | "saved"
  | "marked"
  | "highlighted"
  | "flagged"
  | "checked"
  | "needs-check";

export type ReaderLens = {
  id: `lens:${string}`;
  name: string;
  query: string;
  mode: ReaderLensMode;
  channel: ChannelId | "";
  circle: `circle:${string}` | "";
  sort: FeedSort;
  showMuted: boolean;
  updatedAt: number;
};

const SCOPE_RE = /^(base|base-sepolia):0x[a-f0-9]{40}$/;
const CIRCLE_ID_RE = /^circle:[a-z0-9][a-z0-9-]{0,63}$/;
const VALID_MODES = new Set<ReaderLensMode>([
  "all",
  "unread",
  "mentions",
  "media",
  "refs",
  "saved",
  "marked",
  "highlighted",
  "flagged",
  "checked",
  "needs-check",
]);

export function readerLensScopeKey(
  networkKey: NetworkKey,
  contractAddress: string,
) {
  return isAddress(contractAddress)
    ? `${networkKey}:${contractAddress.toLowerCase()}`
    : "";
}

export function normalizeReaderLensName(value: unknown) {
  if (typeof value !== "string") return "";
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (
    !normalized ||
    hasUnsafeLensChar(normalized) ||
    new TextEncoder().encode(normalized).length > MAX_READER_LENS_NAME_BYTES
  ) {
    return "";
  }
  return normalized;
}

export function normalizeReaderLensQuery(value: unknown) {
  if (typeof value !== "string") return "";
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (
    hasUnsafeLensChar(normalized) ||
    new TextEncoder().encode(normalized).length > MAX_READER_LENS_QUERY_BYTES
  ) {
    return "";
  }
  return normalized;
}

export function readerLensIdFromName(value: string): ReaderLens["id"] | "" {
  const name = normalizeReaderLensName(value);
  if (!name) return "";
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug ? `lens:${slug}` : "";
}

export function normalizeReaderLens(value: unknown): ReaderLens | undefined {
  if (!isPlainRecord(value)) return undefined;
  const name = normalizeReaderLensName(value.name);
  const id = readerLensIdFromName(
    typeof value.id === "string" && value.id.startsWith("lens:")
      ? value.id.slice(5)
      : name,
  );
  if (!name || !id) return undefined;
  const query = normalizeReaderLensQuery(value.query);
  const mode = VALID_MODES.has(value.mode as ReaderLensMode)
    ? (value.mode as ReaderLensMode)
    : "all";
  const channel =
    typeof value.channel === "string"
      ? (channelFromId(value.channel)?.id ?? "")
      : "";
  const circle =
    typeof value.circle === "string" && CIRCLE_ID_RE.test(value.circle)
      ? (value.circle as ReaderLens["circle"])
      : "";
  const sort = value.sort === "oldest" ? "oldest" : "newest";
  const updatedAt =
    typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt)
      ? Math.max(0, Math.floor(value.updatedAt))
      : 0;
  return {
    id,
    name,
    query,
    mode,
    channel,
    circle,
    sort,
    showMuted: Boolean(value.showMuted),
    updatedAt,
  };
}

export function normalizeReaderLenses(value: unknown) {
  if (!Array.isArray(value)) return [];
  const byId = new Map<ReaderLens["id"], ReaderLens>();
  value.forEach((item) => {
    const lens = normalizeReaderLens(item);
    if (!lens) return;
    const current = byId.get(lens.id);
    if (!current || lens.updatedAt >= current.updatedAt) {
      byId.set(lens.id, lens);
    }
  });
  return [...byId.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name))
    .slice(0, MAX_READER_LENSES_PER_SCOPE);
}

export function normalizeReaderLensesByScope(value: unknown) {
  if (!isPlainRecord(value)) return {};
  const entries = Object.entries(value)
    .filter(([key]) => SCOPE_RE.test(key))
    .map(([key, lenses]) => [key, normalizeReaderLenses(lenses)] as const)
    .filter(([, lenses]) => lenses.length > 0)
    .slice(0, MAX_READER_LENS_SCOPES);
  return Object.fromEntries(entries) as Record<string, ReaderLens[]>;
}

export function upsertReaderLens(
  lenses: readonly ReaderLens[],
  lens: ReaderLens,
) {
  return normalizeReaderLenses([
    lens,
    ...lenses.filter((item) => item.id !== lens.id),
  ]);
}

export function deleteReaderLens(
  lenses: readonly ReaderLens[],
  lensId: ReaderLens["id"],
) {
  return normalizeReaderLenses(lenses).filter((lens) => lens.id !== lensId);
}

function hasUnsafeLensChar(value: string) {
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
