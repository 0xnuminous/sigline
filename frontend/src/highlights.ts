export const MAX_HIGHLIGHT_TERMS = 20;
export const MAX_HIGHLIGHT_TERM_BYTES = 40;

export type HighlightTerm = string;

export function normalizeHighlightTerm(value: unknown) {
  if (typeof value !== "string") return "";
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  if (
    !normalized ||
    hasUnsafeHighlightChar(normalized) ||
    new TextEncoder().encode(normalized).length > MAX_HIGHLIGHT_TERM_BYTES
  ) {
    return "";
  }
  return normalized;
}

export function normalizeHighlightTerms(value: unknown) {
  if (!Array.isArray(value)) return [];
  const terms = new Set<string>();
  value.forEach((item) => {
    const normalized = normalizeHighlightTerm(item);
    if (normalized) terms.add(normalized);
  });
  return [...terms].sort().slice(0, MAX_HIGHLIGHT_TERMS);
}

export function matchingHighlightTerms(
  terms: readonly HighlightTerm[],
  parts: readonly unknown[],
) {
  if (!terms.length) return [];
  const haystack = parts
    .filter((part): part is string => typeof part === "string")
    .join(" ")
    .normalize("NFKC")
    .toLowerCase();
  if (!haystack) return [];
  return normalizeHighlightTerms(terms).filter((term) => haystack.includes(term));
}

function hasUnsafeHighlightChar(value: string) {
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
