import { getAddress, isAddress } from "ethers";

export const MAX_WALLET_LABELS = 200;
export const MAX_WALLET_LABEL_BYTES = 64;

export type WalletLabels = Record<string, string>;

export function normalizeWalletLabel(value: unknown) {
  if (typeof value !== "string") return "";
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (
    !normalized ||
    hasUnsafeLabelChar(normalized) ||
    new TextEncoder().encode(normalized).length > MAX_WALLET_LABEL_BYTES
  ) {
    return "";
  }
  return normalized;
}

export function normalizeWalletLabels(value: unknown): WalletLabels {
  if (!isPlainRecord(value)) return {};
  const byAddress = new Map<string, string>();
  Object.entries(value).forEach(([address, label]) => {
    if (!isAddress(address)) return;
    const normalized = normalizeWalletLabel(label);
    if (!normalized) return;
    const checksum = getAddress(address);
    byAddress.set(checksum.toLowerCase(), normalized);
  });
  return Object.fromEntries(
    [...byAddress.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, MAX_WALLET_LABELS),
  );
}

export function getWalletLabel(labels: WalletLabels, address: string) {
  if (!isAddress(address)) return "";
  return labels[getAddress(address).toLowerCase()] ?? "";
}

export function setWalletLabel(
  labels: WalletLabels,
  address: string,
  label: string,
) {
  const current = normalizeWalletLabels(labels);
  if (!isAddress(address)) return current;
  const key = getAddress(address).toLowerCase();
  const normalized = normalizeWalletLabel(label);
  if (!normalized) {
    delete current[key];
    return current;
  }
  return normalizeWalletLabels({ ...current, [key]: normalized });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasUnsafeLabelChar(value: string) {
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
