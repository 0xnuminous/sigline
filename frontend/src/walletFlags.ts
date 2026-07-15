import { getAddress, isAddress } from "ethers";

export const MAX_WALLET_FLAGS = 200;
export const WALLET_FLAGS = ["trusted", "watch", "blocked"] as const;

export type WalletFlag = (typeof WALLET_FLAGS)[number];
export type WalletFlags = Record<string, WalletFlag>;

const FLAG_SET = new Set<string>(WALLET_FLAGS);

export function normalizeWalletFlag(value: unknown): WalletFlag | "" {
  return typeof value === "string" && FLAG_SET.has(value)
    ? (value as WalletFlag)
    : "";
}

export function normalizeWalletFlags(value: unknown): WalletFlags {
  if (!isPlainRecord(value)) return {};
  const byAddress = new Map<string, WalletFlag>();
  Object.entries(value).forEach(([address, flag]) => {
    if (!isAddress(address)) return;
    const normalized = normalizeWalletFlag(flag);
    if (!normalized) return;
    byAddress.set(getAddress(address).toLowerCase(), normalized);
  });
  return Object.fromEntries(
    [...byAddress.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, MAX_WALLET_FLAGS),
  );
}

export function getWalletFlag(flags: WalletFlags, address: string) {
  if (!isAddress(address)) return "";
  return normalizeWalletFlag(flags[getAddress(address).toLowerCase()]);
}

export function setWalletFlag(
  flags: WalletFlags,
  address: string,
  flag: WalletFlag | "",
) {
  const current = normalizeWalletFlags(flags);
  if (!isAddress(address)) return current;
  const key = getAddress(address).toLowerCase();
  if (!flag) {
    delete current[key];
    return current;
  }
  return normalizeWalletFlags({ ...current, [key]: flag });
}

export function nextWalletFlag(flag: WalletFlag | ""): WalletFlag | "" {
  if (!flag) return WALLET_FLAGS[0];
  const index = WALLET_FLAGS.indexOf(flag);
  if (index < 0) return WALLET_FLAGS[0];
  return WALLET_FLAGS[index + 1] ?? "";
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
