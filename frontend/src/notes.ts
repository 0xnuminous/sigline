export const MAX_LINE_NOTES = 300;
export const MAX_LINE_NOTE_BYTES = 280;

export type LineNotes = Record<string, string>;

const HEX_32_RE = /^0x[a-fA-F0-9]{64}$/;

export function normalizeLineNote(value: unknown) {
  if (typeof value !== "string") return "";
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (
    !normalized ||
    hasUnsafeNoteChar(normalized) ||
    new TextEncoder().encode(normalized).length > MAX_LINE_NOTE_BYTES
  ) {
    return "";
  }
  return normalized;
}

export function normalizeLineNotes(value: unknown): LineNotes {
  if (!isPlainRecord(value)) return {};
  const byHash = new Map<string, string>();
  Object.entries(value).forEach(([hash, note]) => {
    if (!HEX_32_RE.test(hash)) return;
    const normalized = normalizeLineNote(note);
    if (!normalized) return;
    byHash.set(hash.toLowerCase(), normalized);
  });
  return Object.fromEntries(
    [...byHash.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, MAX_LINE_NOTES),
  );
}

export function getLineNote(notes: LineNotes, contentHash: string) {
  return HEX_32_RE.test(contentHash) ? notes[contentHash.toLowerCase()] ?? "" : "";
}

export function setLineNote(
  notes: LineNotes,
  contentHash: string,
  note: string,
) {
  const current = normalizeLineNotes(notes);
  if (!HEX_32_RE.test(contentHash)) return current;
  const key = contentHash.toLowerCase();
  const normalized = normalizeLineNote(note);
  if (!normalized) {
    delete current[key];
    return current;
  }
  return normalizeLineNotes({ ...current, [key]: normalized });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasUnsafeNoteChar(value: string) {
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
