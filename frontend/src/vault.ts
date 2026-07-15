import { SAVED_SETTINGS_KEYS, STORAGE_KEY } from "./chain";
import { serializeReaderSources } from "./readerSources";

export const LOCAL_VAULT_SCHEMA = "sigline.localVault.v1";
export const LOCAL_VAULT_KDF = "PBKDF2-SHA256";
export const LOCAL_VAULT_CIPHER = "AES-GCM-256";
export const LOCAL_VAULT_ITERATIONS = 210_000;
export const MAX_LOCAL_SETTINGS_BYTES = 256_000;
export const MAX_LOCAL_VAULT_BYTES = 512_000;
export const MIN_LOCAL_BACKUP_PASSPHRASE_CHARS = 16;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const BASE64_CHUNK_SIZE = 0x8000;

type LocalVault = {
  schema: typeof LOCAL_VAULT_SCHEMA;
  exportedAt: string;
  storageKey: typeof STORAGE_KEY;
  kdf: typeof LOCAL_VAULT_KDF;
  cipher: typeof LOCAL_VAULT_CIPHER;
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
};

export type LocalSettingsSummary = {
  network: string;
  contract: string;
  rpc: string;
  proofRpc: string;
  upload: string;
  imageGatewayMode: string;
  tracked: number;
  labels: number;
  flags: number;
  notes: number;
  marks: number;
  circles: number;
  lenses: number;
  readerSources: number;
  profilePins: number;
  drafts: number;
  mutedWallets: number;
  mutedTerms: number;
  highlights: number;
  savedLines: number;
  savedCache: number;
  hasDraft: boolean;
};

const SETTINGS_KEYS = new Set<string>(SAVED_SETTINGS_KEYS);

export async function exportEncryptedVault(
  settingsJson: string,
  passphrase: string,
  exportedAt = new Date().toISOString(),
) {
  const plaintext = normalizeSettingsJson(settingsJson);
  const pass = normalizePassphrase(passphrase);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveVaultKey(pass, salt);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(plaintext),
    ),
  );
  return JSON.stringify(
    {
      schema: LOCAL_VAULT_SCHEMA,
      exportedAt,
      storageKey: STORAGE_KEY,
      kdf: LOCAL_VAULT_KDF,
      cipher: LOCAL_VAULT_CIPHER,
      iterations: LOCAL_VAULT_ITERATIONS,
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(ciphertext),
    } satisfies LocalVault,
    null,
    2,
  );
}

export async function importEncryptedVault(value: string, passphrase: string) {
  if (new TextEncoder().encode(value).length > MAX_LOCAL_VAULT_BYTES) {
    throw new Error("Encrypted vault is too large.");
  }
  const vault = parseVault(value);
  const pass = normalizePassphrase(passphrase);
  const salt = base64ToBytes(vault.salt);
  const iv = base64ToBytes(vault.iv);
  const ciphertext = base64ToBytes(vault.ciphertext);
  if (salt.byteLength !== SALT_BYTES || iv.byteLength !== IV_BYTES) {
    throw new Error("Encrypted vault key material is invalid.");
  }
  if (ciphertext.byteLength === 0 || ciphertext.byteLength > MAX_LOCAL_VAULT_BYTES) {
    throw new Error("Encrypted vault ciphertext is invalid.");
  }
  const key = await deriveVaultKey(pass, salt);
  let plaintext: Uint8Array;
  try {
    plaintext = new Uint8Array(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext),
    );
  } catch (error) {
    throw new Error("Vault passphrase or ciphertext is invalid.", { cause: error });
  }
  return normalizeSettingsJson(new TextDecoder().decode(plaintext));
}

export function normalizeSettingsJson(value: string) {
  if (new TextEncoder().encode(value).length > MAX_LOCAL_SETTINGS_BYTES) {
    throw new Error("Local settings are too large.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value || "{}");
  } catch {
    throw new Error("Local settings JSON is invalid.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Local settings must be a JSON object.");
  }
  const filtered: Record<string, unknown> = {};
  Object.entries(parsed as Record<string, unknown>).forEach(([key, item]) => {
    if (!SETTINGS_KEYS.has(key)) return;
    filtered[key] = key === "readerSources" ? serializeReaderSources(item) : item;
  });
  return JSON.stringify(filtered);
}

export function summarizeSettingsJson(value: string): LocalSettingsSummary {
  const settings = JSON.parse(normalizeSettingsJson(value)) as Record<string, unknown>;
  const contracts =
    settings.contractsByNetwork &&
    typeof settings.contractsByNetwork === "object" &&
    !Array.isArray(settings.contractsByNetwork)
      ? (settings.contractsByNetwork as Record<string, unknown>)
      : {};
  const network =
    typeof settings.networkKey === "string" ? settings.networkKey : "default";
  const contract = String(contracts[network] ?? "");
  const cache =
    settings.savedLineCache &&
    typeof settings.savedLineCache === "object" &&
    !Array.isArray(settings.savedLineCache)
      ? settings.savedLineCache
      : {};
  return {
    network,
    contract: contract || "not set",
    rpc: hostLabel(settings.rpcUrl),
    proofRpc: hostLabel(settings.proofRpcUrl),
    upload: hostLabel(settings.imageUploadEndpoint),
    imageGatewayMode: imageGatewayModeLabel(settings.imageGatewayMode),
    tracked: countArray(settings.trackedSigners),
    labels: countRecord(settings.walletLabels),
    flags: countRecord(settings.walletFlags),
    notes: countRecord(settings.lineNotes),
    marks: countRecord(settings.lineMarks),
    circles: countCircles(settings.circlesByScope),
    lenses: countLenses(settings.readerLensesByScope),
    readerSources: countArray(settings.readerSources),
    profilePins: countNestedRecords(settings.profilePinsByScope),
    drafts: countArray(settings.draftQueue),
    mutedWallets: countArray(settings.mutedSigners),
    mutedTerms: countArray(settings.mutedTerms),
    highlights: countArray(settings.highlightedTerms),
    savedLines: countArray(settings.savedLines),
    savedCache: Object.keys(cache).length,
    hasDraft: Boolean(
      settings.draftText || settings.draftReference || countArray(settings.draftQueue),
    ),
  };
}

export function formatSettingsImportSummary(
  currentJson: string,
  incomingJson: string,
) {
  const current = summarizeSettingsJson(currentJson);
  const incoming = summarizeSettingsJson(incomingJson);
  return [
    "Import encrypted settings backup?",
    "",
    `Network: ${current.network} -> ${incoming.network}`,
    `Contract: ${current.contract} -> ${incoming.contract}`,
    `RPC: ${current.rpc} -> ${incoming.rpc}`,
    `Proof RPC: ${current.proofRpc} -> ${incoming.proofRpc}`,
    `Upload endpoint: ${current.upload} -> ${incoming.upload}`,
    `Image checks: ${current.imageGatewayMode} -> ${incoming.imageGatewayMode}`,
    `Tracked wallets: ${current.tracked} -> ${incoming.tracked}`,
    `Private labels: ${current.labels} -> ${incoming.labels}`,
    `Private wallet flags: ${current.flags} -> ${incoming.flags}`,
    `Private notes: ${current.notes} -> ${incoming.notes}`,
    `Private marks: ${current.marks} -> ${incoming.marks}`,
    `Circles: ${current.circles} -> ${incoming.circles}`,
    `Reader lenses: ${current.lenses} -> ${incoming.lenses}`,
    `Reader sources: ${current.readerSources} -> ${incoming.readerSources}`,
    `Profile pins: ${current.profilePins} -> ${incoming.profilePins}`,
    `Draft queue: ${current.drafts} -> ${incoming.drafts}`,
    `Muted wallets/text: ${current.mutedWallets}/${current.mutedTerms} -> ${incoming.mutedWallets}/${incoming.mutedTerms}`,
    `Highlighted text: ${current.highlights} -> ${incoming.highlights}`,
    `Saved lines/cache: ${current.savedLines}/${current.savedCache} -> ${incoming.savedLines}/${incoming.savedCache}`,
    `Draft: ${current.hasDraft ? "yes" : "no"} -> ${incoming.hasDraft ? "yes" : "no"}`,
    "",
    "This replaces only local browser settings. On-chain posts are not changed.",
  ].join("\n");
}

function parseVault(value: string): LocalVault {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Encrypted vault JSON is invalid.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Encrypted vault must be a JSON object.");
  }
  const vault = parsed as Partial<LocalVault>;
  if (
    vault.schema !== LOCAL_VAULT_SCHEMA ||
    vault.storageKey !== STORAGE_KEY ||
    vault.kdf !== LOCAL_VAULT_KDF ||
    vault.cipher !== LOCAL_VAULT_CIPHER ||
    vault.iterations !== LOCAL_VAULT_ITERATIONS ||
    typeof vault.salt !== "string" ||
    typeof vault.iv !== "string" ||
    typeof vault.ciphertext !== "string"
  ) {
    throw new Error("Encrypted vault schema is not supported.");
  }
  return vault as LocalVault;
}

async function deriveVaultKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
) {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations: LOCAL_VAULT_ITERATIONS,
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function normalizePassphrase(value: string) {
  const passphrase = value.normalize("NFKC");
  if (passphrase.length < MIN_LOCAL_BACKUP_PASSPHRASE_CHARS) {
    throw new Error(
      `Use an encrypted backup passphrase with at least ${MIN_LOCAL_BACKUP_PASSPHRASE_CHARS} characters.`,
    );
  }
  return passphrase;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.byteLength; offset += BASE64_CHUNK_SIZE) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + BASE64_CHUNK_SIZE),
    );
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  try {
    return Uint8Array.from(atob(value), (char) =>
      char.charCodeAt(0),
    ) as Uint8Array<ArrayBuffer>;
  } catch {
    throw new Error("Encrypted vault contains invalid base64.");
  }
}

function countArray(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function countRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).length
    : 0;
}

function countCircles(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  return Object.values(value as Record<string, unknown>).reduce(
    (total: number, item) => total + countArray(item),
    0,
  );
}

function countLenses(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  return Object.values(value as Record<string, unknown>).reduce(
    (total: number, item) => total + countArray(item),
    0,
  );
}

function countNestedRecords(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  return Object.values(value as Record<string, unknown>).reduce(
    (total: number, item) => total + countRecord(item),
    0,
  );
}

function hostLabel(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return "not set";
  try {
    return new URL(value).host || value;
  } catch {
    return value;
  }
}

function imageGatewayModeLabel(value: unknown) {
  if (value === "configured") return "configured gateway only";
  if (value === "fallbacks") return "configured + public fallbacks";
  return "default";
}
