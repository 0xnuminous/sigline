export const MAX_LINE_MARKS = 300;
export const LINE_MARKS = ["important", "question", "verify", "later"] as const;

export type LineMark = (typeof LINE_MARKS)[number];
export type LineMarks = Record<string, LineMark>;

const HEX_32_RE = /^0x[a-fA-F0-9]{64}$/;
const MARK_SET = new Set<string>(LINE_MARKS);

export function normalizeLineMark(value: unknown): LineMark | "" {
  if (value === "signal") return "important";
  return typeof value === "string" && MARK_SET.has(value)
    ? (value as LineMark)
    : "";
}

export function normalizeLineMarks(value: unknown): LineMarks {
  if (!isPlainRecord(value)) return {};
  const byHash = new Map<string, LineMark>();
  Object.entries(value).forEach(([hash, mark]) => {
    if (!HEX_32_RE.test(hash)) return;
    const normalized = normalizeLineMark(mark);
    if (!normalized) return;
    byHash.set(hash.toLowerCase(), normalized);
  });
  return Object.fromEntries(
    [...byHash.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, MAX_LINE_MARKS),
  );
}

export function getLineMark(marks: LineMarks, contentHash: string) {
  return HEX_32_RE.test(contentHash)
    ? normalizeLineMark(marks[contentHash.toLowerCase()])
    : "";
}

export function setLineMark(
  marks: LineMarks,
  contentHash: string,
  mark: LineMark | "",
) {
  const current = normalizeLineMarks(marks);
  if (!HEX_32_RE.test(contentHash)) return current;
  const key = contentHash.toLowerCase();
  if (!mark) {
    delete current[key];
    return current;
  }
  return normalizeLineMarks({ ...current, [key]: mark });
}

export function nextLineMark(mark: LineMark | ""): LineMark | "" {
  if (!mark) return LINE_MARKS[0];
  const index = LINE_MARKS.indexOf(mark);
  if (index < 0) return LINE_MARKS[0];
  return LINE_MARKS[index + 1] ?? "";
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
