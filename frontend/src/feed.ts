import {
  REF_KIND_ECHO,
  REF_KIND_NONE,
  REF_KIND_REPLY,
  TimelineItem,
  MAX_IMAGE_URI_BYTES,
  MAX_POST_BYTES,
  NETWORKS,
  ZERO_HASH,
  computePostContentHash,
  type NetworkKey,
  type Sigcard,
} from "./chain";
import {
  getAddress,
  isAddress,
  keccak256,
  toUtf8Bytes,
  verifyMessage,
} from "ethers";
import { imageUriToGateway } from "./uploads";

export type FeedSort = "newest" | "oldest";
export const MAX_FEED_BUNDLE_IMPORT_BYTES = 128_000;
export const MAX_FEED_BUNDLE_IMPORT_LINES = 40;
export const MAX_FEED_BUNDLE_IMPORT_AUTHORS = 50;

export type FeedStats = {
  lines: number;
  media: number;
  refs: number;
  wallets: number;
  unread: number;
  saved: number;
};

export type ThreadChildren = {
  answers: TimelineItem[];
  echoes: TimelineItem[];
};

export type FeedExportOptions = {
  exportedAt?: string;
  network?: string;
  chainId?: string;
  contract?: string;
  lineExtras?: (item: TimelineItem) => Record<string, unknown>;
};

export type FeedBundleImportContext = {
  network?: NetworkKey | string;
  chainId?: string;
  contract?: string;
};

export type FeedBundleImportResult = {
  schema: "sigline.feed.v1" | "sigline.followPack.v1";
  lineCount: number;
  authors: string[];
  context?: FeedBundleImportContext;
  warnings: string[];
  signature?: FeedBundleSignatureStatus;
};

type BundleImageUriKind = "none" | "content-addressed" | "external";

export type FeedBundleSignatureStatus = {
  signer: string;
  signedAt: string;
  payloadHash: string;
};

type FeedBundleSignature = FeedBundleSignatureStatus & {
  schema: "sigline.bundleSignature.v1";
  signature: string;
};

type ValidatedBundleLine = {
  author: string;
  item: TimelineItem;
  imageKind: BundleImageUriKind;
};

const BYTES32_RE = /^0x[a-fA-F0-9]{64}$/;
const UINT_RE = /^\d+$/;

export function getBundleSignatureMessage(value: string | Record<string, unknown>) {
  const unsigned = parseUnsignedBundleObject(value);
  const context = isRecord(unsigned.context) ? unsigned.context : {};
  const contract =
    typeof context.contract === "string" && isAddress(context.contract)
      ? getAddress(context.contract)
      : String(context.contract ?? "");
  return [
    "Sigline bundle signature v1",
    `schema: ${String(unsigned.schema ?? "")}`,
    `network: ${String(context.network ?? "")}`,
    `chainId: ${String(context.chainId ?? "")}`,
    `contract: ${contract}`,
    `exportedAt: ${String(unsigned.exportedAt ?? "")}`,
    `payloadHash: ${getBundlePayloadHash(unsigned)}`,
  ].join("\n");
}

export function attachBundleSignature(
  value: string | Record<string, unknown>,
  signer: string,
  signature: string,
  signedAt = new Date().toISOString(),
) {
  const unsigned = parseUnsignedBundleObject(value);
  const normalizedSigner = getAddress(signer);
  const payloadHash = getBundlePayloadHash(unsigned);
  let recovered: string;
  try {
    recovered = getAddress(verifyMessage(getBundleSignatureMessage(unsigned), signature));
  } catch {
    throw new Error("Bundle signature is invalid.");
  }
  if (recovered !== normalizedSigner) {
    throw new Error("Bundle signature signer does not match.");
  }
  return JSON.stringify(
    {
      ...unsigned,
      signature: {
        schema: "sigline.bundleSignature.v1",
        signer: normalizedSigner,
        signedAt,
        payloadHash,
        signature,
      } satisfies FeedBundleSignature,
    },
    null,
    2,
  );
}

export function sortFeedRows(items: TimelineItem[], sort: FeedSort) {
  return [...items].sort((a, b) => {
    const byTime = a.createdAt - b.createdAt;
    const byIndex = Number(a.index - b.index);
    const order = byTime || byIndex;
    return sort === "oldest" ? order : -order;
  });
}

export function lineNeedsCurrentCheck(
  item: Pick<TimelineItem, "id">,
  trust: { trusted: boolean },
) {
  return !item.id.startsWith("sample-") && !trust.trusted;
}

export function getFeedStats(
  rows: TimelineItem[],
  savedHashes: ReadonlySet<string> = new Set(),
  readHashes: ReadonlySet<string> = new Set(),
): FeedStats {
  const wallets = new Set(rows.map((item) => item.author.toLowerCase()));
  return {
    lines: rows.length,
    media: rows.filter(
      (item) => item.imageUri && item.imageHash.toLowerCase() !== ZERO_HASH,
    ).length,
    refs: rows.filter(
      (item) => item.refKind !== REF_KIND_NONE && item.refHash !== ZERO_HASH,
    ).length,
    wallets: wallets.size,
    unread: rows.filter(
      (item) => !readHashes.has(item.contentHash.toLowerCase()),
    ).length,
    saved: rows.filter((item) => savedHashes.has(item.contentHash.toLowerCase()))
      .length,
  };
}

export function getThreadChildrenByHash(rows: TimelineItem[]) {
  const children = new Map<string, ThreadChildren>();
  for (const item of rows) {
    if (item.refKind === REF_KIND_NONE || item.refHash === ZERO_HASH) continue;
    const key = item.refHash.toLowerCase();
    const bucket = children.get(key) ?? { answers: [], echoes: [] };
    if (item.refKind === REF_KIND_REPLY) {
      bucket.answers = [...bucket.answers, item];
    } else if (item.refKind === REF_KIND_ECHO) {
      bucket.echoes = [...bucket.echoes, item];
    }
    children.set(key, bucket);
  }
  return children;
}

export function parseFeedBundleImport(
  value: string,
  expected: FeedBundleImportContext = {},
): FeedBundleImportResult {
  const bytes = new TextEncoder().encode(value).length;
  if (bytes > MAX_FEED_BUNDLE_IMPORT_BYTES) {
    throw new Error("Feed bundle is over 128 KB.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Feed bundle JSON is invalid.");
  }
  if (!isRecord(parsed)) throw new Error("Feed bundle must be a JSON object.");
  if (parsed.schema === "sigline.followPack.v1") {
    return parseFollowPackImport(parsed, expected);
  }
  const signature = verifyBundleSignature(parsed);
  const allowedTopLevel = new Set([
    "schema",
    "exportedAt",
    "context",
    "count",
    "lines",
    "signature",
  ]);
  Object.keys(parsed).forEach((key) => {
    if (!allowedTopLevel.has(key)) {
      throw new Error(`Feed bundle contains unsupported field ${key}.`);
    }
  });
  if (parsed.schema !== "sigline.feed.v1") {
    throw new Error("Feed bundle schema is not supported.");
  }

  const context = normalizeImportContext(parsed.context);
  const bundleChainId = context?.chainId;
  const bundleContract = context?.contract;
  if (!context?.network || !bundleChainId || !bundleContract) {
    throw new Error("Feed bundle context must include network, chainId, and contract.");
  }
  assertContextMatches(context, expected);

  if (!Array.isArray(parsed.lines)) {
    throw new Error("Feed bundle lines must be an array.");
  }
  if (parsed.lines.length > MAX_FEED_BUNDLE_IMPORT_LINES) {
    throw new Error("Feed bundle has too many lines.");
  }
  if (
    parsed.count !== undefined &&
    (!Number.isInteger(parsed.count) || parsed.count !== parsed.lines.length)
  ) {
    throw new Error("Feed bundle line count is inconsistent.");
  }

  const authors = new Set<string>();
  const seenContent = new Set<string>();
  const seenPointer = new Set<string>();
  let externalImageCount = 0;
  parsed.lines.forEach((line, index) => {
    const { author, item, imageKind } = validateBundleLine(line, index);
    const expectedHash = computePostContentHash(
      bundleContract,
      BigInt(bundleChainId),
      item,
    ).toLowerCase();
    if (expectedHash !== item.contentHash.toLowerCase()) {
      throw new Error(`Feed bundle line ${index + 1} has a mismatched contentHash.`);
    }
    const pointerKey = `${author.toLowerCase()}:${item.index.toString()}`;
    if (seenContent.has(item.contentHash.toLowerCase())) {
      throw new Error(`Feed bundle line ${index + 1} duplicates a content hash.`);
    }
    if (seenPointer.has(pointerKey)) {
      throw new Error(`Feed bundle line ${index + 1} duplicates an author/index.`);
    }
    seenContent.add(item.contentHash.toLowerCase());
    seenPointer.add(pointerKey);
    authors.add(author.toLowerCase());
    if (imageKind === "external") externalImageCount += 1;
  });
  if (!authors.size) throw new Error("Feed bundle has no authors to track.");
  if (authors.size > MAX_FEED_BUNDLE_IMPORT_AUTHORS) {
    throw new Error("Feed bundle has too many wallets.");
  }

  const warnings: string[] = [];
  if (externalImageCount) {
    warnings.push(
      `${externalImageCount} bundled image URI${externalImageCount === 1 ? "" : "s"} use HTTPS; verify image bytes before rendering.`,
    );
  }

  return {
    schema: "sigline.feed.v1",
    lineCount: parsed.lines.length,
    authors: [...authors].map(getAddress).sort(),
    context,
    warnings,
    signature,
  };
}

export function serializeFollowPackExport(
  addresses: string[],
  sigcards: Record<string, Sigcard>,
  options: FeedBundleImportContext & { exportedAt?: string } = {},
) {
  const context = normalizeImportContext({
    network: options.network,
    chainId: options.chainId,
    contract: options.contract,
  });
  const wallets = normalizeWalletList(addresses).map((address) => {
    const card = sigcards[address.toLowerCase()];
    return {
      address,
      alias: card?.nick.trim().slice(0, 64) || undefined,
    };
  });
  return JSON.stringify(
    {
      schema: "sigline.followPack.v1",
      exportedAt: options.exportedAt ?? new Date().toISOString(),
      context,
      count: wallets.length,
      wallets,
    },
    null,
    2,
  );
}

function parseFollowPackImport(
  parsed: Record<string, unknown>,
  expected: FeedBundleImportContext,
): FeedBundleImportResult {
  const signature = verifyBundleSignature(parsed);
  const allowedTopLevel = new Set([
    "schema",
    "exportedAt",
    "context",
    "count",
    "wallets",
    "signature",
  ]);
  Object.keys(parsed).forEach((key) => {
    if (!allowedTopLevel.has(key)) {
      throw new Error(`Follow pack contains unsupported field ${key}.`);
    }
  });
  const context = normalizeImportContext(parsed.context);
  assertContextMatches(context, expected);
  if (!Array.isArray(parsed.wallets)) {
    throw new Error("Follow pack wallets must be an array.");
  }
  if (parsed.wallets.length > MAX_FEED_BUNDLE_IMPORT_AUTHORS) {
    throw new Error("Follow pack has too many wallets.");
  }
  if (
    parsed.count !== undefined &&
    (!Number.isInteger(parsed.count) || parsed.count !== parsed.wallets.length)
  ) {
    throw new Error("Follow pack wallet count is inconsistent.");
  }
  const authors = parsed.wallets.map((wallet, index) => {
    if (!isRecord(wallet)) {
      throw new Error(`Follow pack wallet ${index + 1} must be an object.`);
    }
    if (wallet.alias !== undefined && (typeof wallet.alias !== "string" || wallet.alias.length > 64)) {
      throw new Error(`Follow pack wallet ${index + 1} has an invalid alias.`);
    }
    const address = String(wallet.address ?? "");
    if (!isAddress(address)) {
      throw new Error(`Follow pack wallet ${index + 1} has an invalid address.`);
    }
    return getAddress(address);
  });
  const unique = normalizeWalletList(authors);
  if (!unique.length) throw new Error("Follow pack has no wallets to track.");
  return {
    schema: "sigline.followPack.v1",
    lineCount: 0,
    authors: unique,
    context,
    warnings: [],
    signature,
  };
}

function validateBundleLine(value: unknown, index: number): ValidatedBundleLine {
  if (!isRecord(value)) {
    throw new Error(`Feed bundle line ${index + 1} must be an object.`);
  }
  const author = String(value.author ?? "");
  if (!isAddress(author)) {
    throw new Error(`Feed bundle line ${index + 1} has an invalid author.`);
  }
  const text = value.text;
  if (
    text !== undefined &&
    (typeof text !== "string" ||
      new TextEncoder().encode(text.trim()).length > MAX_POST_BYTES)
  ) {
    throw new Error(`Feed bundle line ${index + 1} has invalid text.`);
  }
  const imageUri = value.imageUri;
  let imageKind: BundleImageUriKind = "none";
  if (imageUri !== undefined) {
    if (
      typeof imageUri !== "string" ||
      new TextEncoder().encode(imageUri).length > MAX_IMAGE_URI_BYTES
    ) {
      throw new Error(`Feed bundle line ${index + 1} has an invalid imageUri.`);
    }
    const detectedKind = getImageUriKind(imageUri);
    if (detectedKind === "invalid") {
      throw new Error(`Feed bundle line ${index + 1} has an invalid imageUri.`);
    }
    imageKind = detectedKind;
  }
  const alias = value.alias;
  if (alias !== undefined && (typeof alias !== "string" || alias.length > 64)) {
    throw new Error(`Feed bundle line ${index + 1} has an invalid alias.`);
  }
  const publicUrl = value.publicUrl;
  if (
    publicUrl !== undefined &&
    (typeof publicUrl !== "string" ||
      publicUrl.length > 2048 ||
      !isHttpUrl(publicUrl))
  ) {
    throw new Error(`Feed bundle line ${index + 1} has an invalid publicUrl.`);
  }
  validateBundleVerification(value.verification, index);
  for (const field of ["contentHash", "txHash"] as const) {
    if (!BYTES32_RE.test(String(value[field] ?? ""))) {
      throw new Error(`Feed bundle line ${index + 1} has an invalid ${field}.`);
    }
  }
  for (const field of ["index"] as const) {
    if (!UINT_RE.test(String(value[field] ?? ""))) {
      throw new Error(`Feed bundle line ${index + 1} has an invalid ${field}.`);
    }
  }
  for (const field of ["createdAt", "blockNumber"] as const) {
    if (!Number.isInteger(value[field]) || Number(value[field]) < 0) {
      throw new Error(`Feed bundle line ${index + 1} has an invalid ${field}.`);
    }
  }
  for (const field of ["imageHash", "refHash"] as const) {
    const candidate = value[field];
    if (candidate !== undefined && !BYTES32_RE.test(String(candidate))) {
      throw new Error(`Feed bundle line ${index + 1} has an invalid ${field}.`);
    }
  }
  const normalizedImageUri = String(imageUri ?? "");
  const imageHash = String(value.imageHash ?? ZERO_HASH).toLowerCase();
  if (!normalizedImageUri && imageHash !== ZERO_HASH) {
    throw new Error(`Feed bundle line ${index + 1} has an invalid image reference.`);
  }
  if (normalizedImageUri && imageHash === ZERO_HASH) {
    throw new Error(`Feed bundle line ${index + 1} has an invalid image reference.`);
  }
  if (
    value.refKind !== undefined &&
    ![REF_KIND_NONE, REF_KIND_REPLY, REF_KIND_ECHO].includes(Number(value.refKind))
  ) {
    throw new Error(`Feed bundle line ${index + 1} has an invalid refKind.`);
  }
  const refKind = Number(value.refKind ?? REF_KIND_NONE);
  const refHash = String(value.refHash ?? ZERO_HASH).toLowerCase();
  if (refKind === REF_KIND_NONE && refHash !== ZERO_HASH) {
    throw new Error(`Feed bundle line ${index + 1} has an invalid reference.`);
  }
  if (refKind !== REF_KIND_NONE && refHash === ZERO_HASH) {
    throw new Error(`Feed bundle line ${index + 1} has an invalid reference.`);
  }
  const normalizedAuthor = getAddress(author);
  const contentHash = String(value.contentHash).toLowerCase();
  return {
    author: normalizedAuthor,
    imageKind,
    item: {
      id: contentHash,
      author: normalizedAuthor,
      index: BigInt(String(value.index)),
      createdAt: Number(value.createdAt),
      contentHash,
      text: typeof text === "string" ? text : "",
      imageUri: normalizedImageUri,
      imageHash,
      refHash,
      refKind,
      txHash: String(value.txHash).toLowerCase(),
      blockNumber: Number(value.blockNumber),
    },
  };
}

function normalizeImportContext(value: unknown): FeedBundleImportContext | undefined {
  if (value === undefined) {
    throw new Error("Feed bundle context must include network, chainId, and contract.");
  }
  if (!isRecord(value)) throw new Error("Feed bundle context must be an object.");
  const context: FeedBundleImportContext = {};
  if (
    typeof value.network === "string" &&
    (value.network === "base" || value.network === "base-sepolia")
  ) {
    context.network = value.network;
  }
  if (typeof value.chainId === "string" && UINT_RE.test(value.chainId)) {
    context.chainId = value.chainId;
  }
  if (typeof value.contract === "string") {
    if (!isAddress(value.contract)) throw new Error("Feed bundle contract is invalid.");
    context.contract = getAddress(value.contract);
  }
  if (!context.network || !context.chainId || !context.contract) {
    throw new Error("Feed bundle context must include network, chainId, and contract.");
  }
  if (NETWORKS[context.network as NetworkKey].chainId.toString() !== context.chainId) {
    throw new Error("Feed bundle network and chainId do not match.");
  }
  return Object.keys(context).length ? context : undefined;
}

function assertContextMatches(
  actual: FeedBundleImportContext | undefined,
  expected: FeedBundleImportContext,
) {
  if (!actual) return;
  if (actual.network && expected.network && actual.network !== expected.network) {
    throw new Error("Feed bundle network does not match the current network.");
  }
  if (actual.chainId && expected.chainId && actual.chainId !== expected.chainId) {
    throw new Error("Feed bundle chain does not match the current network.");
  }
  if (actual.contract && expected.contract && isAddress(expected.contract)) {
    if (getAddress(actual.contract) !== getAddress(expected.contract)) {
      throw new Error("Feed bundle contract does not match the current contract.");
    }
  }
}

function verifyBundleSignature(
  bundle: Record<string, unknown>,
): FeedBundleSignatureStatus | undefined {
  if (bundle.signature === undefined) return undefined;
  if (!isRecord(bundle.signature)) {
    throw new Error("Bundle signature is invalid.");
  }
  const allowedSignatureFields = new Set([
    "schema",
    "signer",
    "signedAt",
    "payloadHash",
    "signature",
  ]);
  Object.keys(bundle.signature).forEach((key) => {
    if (!allowedSignatureFields.has(key)) {
      throw new Error("Bundle signature is invalid.");
    }
  });
  if (
    bundle.signature.schema !== "sigline.bundleSignature.v1" ||
    typeof bundle.signature.signer !== "string" ||
    !isAddress(bundle.signature.signer) ||
    typeof bundle.signature.signedAt !== "string" ||
    bundle.signature.signedAt.length > 64 ||
    !BYTES32_RE.test(String(bundle.signature.payloadHash ?? "")) ||
    typeof bundle.signature.signature !== "string" ||
    !/^0x[a-fA-F0-9]{130}$/.test(bundle.signature.signature)
  ) {
    throw new Error("Bundle signature is invalid.");
  }
  const signer = getAddress(bundle.signature.signer);
  const payloadHash = String(bundle.signature.payloadHash).toLowerCase();
  const unsigned = parseUnsignedBundleObject(bundle);
  if (getBundlePayloadHash(unsigned).toLowerCase() !== payloadHash) {
    throw new Error("Bundle signature payload hash mismatch.");
  }
  let recovered: string;
  try {
    recovered = getAddress(
      verifyMessage(getBundleSignatureMessage(unsigned), bundle.signature.signature),
    );
  } catch {
    throw new Error("Bundle signature is invalid.");
  }
  if (recovered !== signer) {
    throw new Error("Bundle signature signer does not match.");
  }
  return {
    signer,
    signedAt: bundle.signature.signedAt,
    payloadHash,
  };
}

function parseUnsignedBundleObject(value: string | Record<string, unknown>) {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error("Feed bundle JSON is invalid.");
    }
  }
  if (!isRecord(parsed)) {
    throw new Error("Feed bundle must be a JSON object.");
  }
  const unsigned = { ...parsed };
  delete unsigned.signature;
  return unsigned;
}

function getBundlePayloadHash(value: Record<string, unknown>) {
  return keccak256(toUtf8Bytes(stableJson(value)));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function validateBundleVerification(value: unknown, index: number) {
  if (value === undefined) return;
  if (!isRecord(value)) {
    throw new Error(`Feed bundle line ${index + 1} has invalid verification.`);
  }
  for (const key of ["sameRpc", "independent", "image"] as const) {
    const entry = value[key];
    if (entry === undefined) continue;
    if (!isRecord(entry)) {
      throw new Error(`Feed bundle line ${index + 1} has invalid verification.`);
    }
    if (
      typeof entry.status !== "string" ||
      entry.status.length > 80 ||
      !["idle", "good", "warn", "bad"].includes(String(entry.tone))
    ) {
      throw new Error(`Feed bundle line ${index + 1} has invalid verification.`);
    }
  }
}

function getImageUriKind(value: string): BundleImageUriKind | "invalid" {
  if (!value) return "none";
  if (!imageUriToGateway(value)) return "invalid";
  if (value.startsWith("ipfs://") || value.startsWith("ar://")) {
    return "content-addressed";
  }
  return value.startsWith("https://") && isHttpUrl(value) ? "external" : "invalid";
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && Boolean(url.host);
  } catch {
    return false;
  }
}

function normalizeWalletList(addresses: string[]) {
  return [
    ...new Set(
      addresses
        .filter((address) => isAddress(address))
        .map((address) => getAddress(address).toLowerCase()),
    ),
  ]
    .map(getAddress)
    .sort();
}

export function serializeFeedExport(
  rows: TimelineItem[],
  sigcards: Record<string, Sigcard>,
  options: FeedExportOptions | string = {},
) {
  const opts = typeof options === "string" ? { exportedAt: options } : options;
  const context =
    opts.network || opts.chainId || opts.contract
      ? {
          network: opts.network,
          chainId: opts.chainId,
          contract: opts.contract,
        }
      : undefined;
  return JSON.stringify(
    {
      schema: "sigline.feed.v1",
      exportedAt: opts.exportedAt ?? new Date().toISOString(),
      context,
      count: rows.length,
      lines: rows.map((item) => {
        const card = sigcards[item.author.toLowerCase()];
        return {
          author: item.author,
          alias: card?.nick.trim() || undefined,
          index: item.index.toString(),
          createdAt: item.createdAt,
          blockNumber: item.blockNumber,
          text: item.text,
          imageUri: item.imageUri || undefined,
          imageHash:
            item.imageHash.toLowerCase() === ZERO_HASH
              ? undefined
              : item.imageHash,
          refHash:
            item.refHash.toLowerCase() === ZERO_HASH ? undefined : item.refHash,
          refKind: item.refKind || undefined,
          contentHash: item.contentHash,
          txHash: item.txHash,
          ...opts.lineExtras?.(item),
        };
      }),
    },
    null,
    2,
  );
}
