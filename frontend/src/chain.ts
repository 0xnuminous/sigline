// Network configs, ABI, contract helpers, and chain-related utilities.
// Extracted from main.tsx with no behavior change so the UI layer stays thin.

import {
  BrowserProvider,
  Contract,
  EventLog,
  JsonRpcProvider,
  TypedDataEncoder,
  getAddress,
  isAddress,
  keccak256,
  toUtf8Bytes,
} from "ethers";
import { normalizeCirclesByScope, type LocalCircle } from "./circles";
import { normalizeDraftQueue, type LocalDraft } from "./drafts";
import { normalizeHighlightTerms } from "./highlights";
import { normalizeWalletLabels, type WalletLabels } from "./labels";
import { normalizeReaderLensesByScope, type ReaderLens } from "./lenses";
import { normalizeLineMarks, type LineMarks } from "./marks";
import { normalizeLineNotes, type LineNotes } from "./notes";
import { normalizeProfilePinsByScope, type ProfilePin } from "./profiles";
import { normalizeReaderSources, type ReaderSource } from "./readerSources";
import { normalizeWalletFlags, type WalletFlags } from "./walletFlags";

export type NetworkKey = "base-sepolia" | "base";

export type NetworkConfig = {
  key: NetworkKey;
  label: string;
  short: string;
  chainId: bigint;
  chainHex: string;
  rpcUrl: string;
  explorer: string;
  currency: string;
};

export type TimelineItem = {
  id: string;
  author: string;
  index: bigint;
  createdAt: number;
  contentHash: string;
  text: string;
  imageUri: string;
  imageHash: string;
  refHash: string;
  refKind: number;
  txHash: string;
  blockNumber: number;
};

export type DraftReference = {
  mode: "reply" | "echo";
  networkKey: NetworkKey;
  contractAddress: string;
  author: string;
  index: string;
  createdAt: number;
  contentHash: string;
  text: string;
  imageUri: string;
  imageHash: string;
  refHash: string;
  refKind: number;
  txHash: string;
  blockNumber: number;
};

export type LinePointer = {
  contentHash: string;
  createdAt: number;
  imageHash: string;
  refHash: string;
  refKind: number;
};

export type Sigcard = {
  address: string;
  nick: string;
  twtUrl: string;
  updatedAt: number;
  postCount: bigint;
};

export type StatusTone = "idle" | "good" | "warn" | "bad";
export type ContractMap = Record<NetworkKey, string>;
export type SavedLineProofStatus = {
  tone: StatusTone;
  status: string;
};
export type SavedLineRecord = {
  networkKey: NetworkKey;
  contractAddress: string;
  savedAt: number;
  publicUrl?: string;
  author: string;
  index: string;
  createdAt: number;
  contentHash: string;
  text: string;
  imageUri: string;
  imageHash: string;
  refHash: string;
  refKind: number;
  txHash: string;
  blockNumber: number;
  proof?: {
    sameRpc?: SavedLineProofStatus;
    independent?: SavedLineProofStatus;
    image?: SavedLineProofStatus;
  };
};

export const MAX_POST_BYTES = 140;
export const MAX_IMAGE_BYTES = 1_000_000;
export const MAX_IMAGE_URI_BYTES = 256;
export const MAX_MUTED_TERMS = 25;
export const MAX_MUTED_TERM_BYTES = 40;
export const MAX_READ_LINES = 500;
export const ZERO_HASH = `0x${"0".repeat(64)}`;
export const IMAGE_PASS_FEE_WEI = 10_000_000_000_000_000n;
export const REF_KIND_NONE = 0;
export const REF_KIND_REPLY = 1;
export const REF_KIND_ECHO = 2;
export const EXPECTED_TREASURY = import.meta.env.VITE_SIGLINE_TREASURY ?? "";
export const EXPECTED_POST_TYPEHASH = keccak256(
  toUtf8Bytes(
    "SiglinePost(address author,uint256 index,uint64 createdAt,string text,string imageUri,bytes32 imageHash,bytes32 refHash,uint8 refKind)",
  ),
);

export const NETWORKS: Record<NetworkKey, NetworkConfig> = {
  "base-sepolia": {
    key: "base-sepolia",
    label: "Base Sepolia",
    short: "base.sepolia",
    chainId: 84532n,
    chainHex: "0x14a34",
    rpcUrl: "https://sepolia.base.org",
    explorer: "https://sepolia-explorer.base.org",
    currency: "ETH",
  },
  base: {
    key: "base",
    label: "Base Mainnet",
    short: "base.mainnet",
    chainId: 8453n,
    chainHex: "0x2105",
    rpcUrl: "https://mainnet.base.org",
    explorer: "https://base.blockscout.com",
    currency: "ETH",
  },
};

export const ABI = [
  "function IMAGE_PASS_FEE() view returns (uint256)",
  "function POST_TYPEHASH() view returns (bytes32)",
  "function eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)",
  "function post(string text, string imageUri, bytes32 imageHash) returns (uint256 index, bytes32 contentHash)",
  "function postWithReference(string text, string imageUri, bytes32 imageHash, bytes32 refHash, uint8 refKind) returns (uint256 index, bytes32 contentHash)",
  "function buyImagePass() payable",
  "function sweepFees()",
  "function treasury() view returns (address)",
  "function imagePasses(address account) view returns (bool)",
  "function setProfile(string nick, string twtUrl)",
  "function clearProfile()",
  "function line(address account, uint256 index) view returns (tuple(bytes32 contentHash, uint64 createdAt, bytes32 imageHash, bytes32 refHash, uint8 refKind))",
  "function profile(address account) view returns (tuple(string nick, string twtUrl, uint64 updatedAt))",
  "function postCount(address account) view returns (uint256)",
  "event PostPosted(address indexed author, uint256 indexed index, bytes32 indexed refHash, uint64 createdAt, bytes32 contentHash, string text, string imageUri, bytes32 imageHash, uint8 refKind)",
  "event ImagePassPurchased(address indexed account, uint256 amount)",
  "event TreasurySwept(address indexed treasury, uint256 amount)",
  "event ProfileUpdated(address indexed account, string nick, string twtUrl, uint64 updatedAt)",
  "event ProfileCleared(address indexed account)",
];

const POST_TYPES = {
  SiglinePost: [
    { name: "author", type: "address" },
    { name: "index", type: "uint256" },
    { name: "createdAt", type: "uint64" },
    { name: "text", type: "string" },
    { name: "imageUri", type: "string" },
    { name: "imageHash", type: "bytes32" },
    { name: "refHash", type: "bytes32" },
    { name: "refKind", type: "uint8" },
  ],
};

export const DEFAULT_NETWORK = (import.meta.env.VITE_BASE_NETWORK === "base"
  ? "base"
  : "base-sepolia") as NetworkKey;
export const DEFAULT_CONTRACT =
  import.meta.env.VITE_SIGLINE_CONTRACT ??
  import.meta.env.VITE_BASE_TWTXT_CONTRACT ??
  "";
export const DEFAULT_RPC =
  import.meta.env.VITE_BASE_RPC_URL ?? NETWORKS[DEFAULT_NETWORK].rpcUrl;
export const DEFAULT_FROM_BLOCK = import.meta.env.VITE_BASE_FROM_BLOCK ?? "0";
export const STORAGE_KEY = "sigline.frontend.v1";
export const SAVED_SETTINGS_KEYS = [
  "networkKey",
  "contractsByNetwork",
  "rpcUrl",
  "proofRpcUrl",
  "fromBlock",
  "nextScanBlock",
  "draftText",
  "draftReference",
  "draftQueue",
  "imageUploadMode",
  "imageUploadEndpoint",
  "imageGatewayMode",
  "scanScope",
  "feedSort",
  "trackedSigners",
  "mutedSigners",
  "mutedTerms",
  "highlightedTerms",
  "walletLabels",
  "walletFlags",
  "lineNotes",
  "lineMarks",
  "pinnedChannelsByScope",
  "circlesByScope",
  "readerLensesByScope",
  "readerSources",
  "profilePinsByScope",
  "readLines",
  "savedLines",
  "savedLineCache",
  "showMuted",
] as const;

const HEX_32_RE = /^0x[a-fA-F0-9]{64}$/;

export const samplePosts: TimelineItem[] = [
  {
    id: "sample-1",
    author: "0x8fc6e1d2f21bb22b1013d05ecf1f06fd73cdcb34",
    index: 2n,
    createdAt: Math.floor(Date.now() / 1000) - 420,
    contentHash:
      "0x58c7f3f1e5cf51e2a3bb5f219b8fd32b3e91e50c092116b12dd58f7d3a410001",
    text: "Posting from a wallet, reading from the contract.",
    imageUri: "",
    imageHash: ZERO_HASH,
    refHash: ZERO_HASH,
    refKind: REF_KIND_NONE,
    txHash:
      "0x8b1db7fdcbfc7f18d46db47f36c8cfcf5d50e78f1a2ce3995c28198f54a01001",
    blockNumber: 1842041,
  },
  {
    id: "sample-2",
    author: "0xab7c8803962c0f2f5bbbe3fa8bf41cd82aa1923c",
    index: 0n,
    createdAt: Math.floor(Date.now() / 1000) - 2580,
    contentHash:
      "0xc0ffee0000000000000000000000000000000000000000000000000000000001",
    text: "Small feed. Public history. No account required.",
    imageUri: "",
    imageHash: ZERO_HASH,
    refHash:
      "0x58c7f3f1e5cf51e2a3bb5f219b8fd32b3e91e50c092116b12dd58f7d3a410001",
    refKind: REF_KIND_REPLY,
    txHash:
      "0x9f1db7fdcbfc7f18d46db47f36c8cfcf5d50e78f1a2ce3995c28198f54a01002",
    blockNumber: 1841130,
  },
];

declare global {
  interface Window {
    ethereum?: {
      request: (args: {
        method: string;
        params?: unknown[];
      }) => Promise<unknown>;
      on?: (event: string, callback: (...args: unknown[]) => void) => void;
      removeListener?: (
        event: string,
        callback: (...args: unknown[]) => void,
      ) => void;
    };
  }
}

export async function writableContract(
  contractAddress: string,
  network: NetworkConfig,
  options: { expectedSigner?: string } = {},
) {
  if (!window.ethereum) throw new Error("NO_WALLET");
  const provider = new BrowserProvider(window.ethereum);
  const current = await provider.getNetwork();
  if (current.chainId !== network.chainId) throw new Error("WRONG_NETWORK");
  await assertSiglineContract(provider, contractAddress, network, {
    requireExpectedTreasury: true,
  });
  const signer = await provider.getSigner();
  if (
    options.expectedSigner &&
    (!isAddress(options.expectedSigner) ||
      getAddress(await signer.getAddress()) !== getAddress(options.expectedSigner))
  ) {
    throw new Error("SIGNER_ACCOUNT_CHANGED");
  }
  return new Contract(contractAddress, ABI, signer);
}

export async function ensureWalletOnNetwork(network: NetworkConfig) {
  if (!window.ethereum) throw new Error("NO_WALLET");
  const provider = new BrowserProvider(window.ethereum);
  const current = await provider.getNetwork();
  if (current.chainId !== network.chainId) {
    await switchOrAddNetwork(network);
  }
}

export async function switchOrAddNetwork(network: NetworkConfig) {
  if (!window.ethereum) throw new Error("NO_WALLET");
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: network.chainHex }],
    });
  } catch (error) {
    const maybeCode =
      typeof error === "object" && error && "code" in error
        ? Number((error as { code: unknown }).code)
        : 0;
    if (maybeCode !== 4902) throw error;
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: network.chainHex,
          chainName: network.label,
          rpcUrls: [network.rpcUrl],
          nativeCurrency: {
            name: "Ether",
            symbol: network.currency,
            decimals: 18,
          },
          blockExplorerUrls: [network.explorer],
        },
      ],
    });
  }
}

export async function assertContractDeployed(
  provider: BrowserProvider | JsonRpcProvider,
  contractAddress: string,
) {
  const code = await provider.getCode(contractAddress);
  if (code === "0x") throw new Error("REGISTRY_NOT_FOUND");
}

export async function assertSiglineContract(
  provider: BrowserProvider | JsonRpcProvider,
  contractAddress: string,
  network: NetworkConfig,
  options: { requireExpectedTreasury?: boolean } = {},
) {
  await assertContractDeployed(provider, contractAddress);
  const registry = new Contract(contractAddress, ABI, provider);
  let domain: {
    name?: unknown;
    version?: unknown;
    chainId?: unknown;
    verifyingContract?: unknown;
    [key: number]: unknown;
  };
  let postTypehash: unknown;
  let fee: unknown;
  let treasury: unknown;
  let imagePassFee: bigint | undefined;
  try {
    [domain, postTypehash, fee, treasury] = await Promise.all([
      registry.eip712Domain(),
      registry.POST_TYPEHASH(),
      registry.IMAGE_PASS_FEE(),
      registry.treasury(),
    ]);
    const domainName = String(domain.name ?? domain[1] ?? "");
    const domainVersion = String(domain.version ?? domain[2] ?? "");
    const domainChainId = toBigInt(domain.chainId ?? domain[3] ?? 0);
    imagePassFee = toBigInt(fee);
    const verifyingContract = String(
      domain.verifyingContract ?? domain[4] ?? "",
    );
    if (
      domainName !== "Sigline" ||
      domainVersion !== "1" ||
      domainChainId !== network.chainId ||
      !isAddress(verifyingContract) ||
      getAddress(verifyingContract) !== getAddress(contractAddress) ||
      String(postTypehash).toLowerCase() !==
        EXPECTED_POST_TYPEHASH.toLowerCase() ||
      imagePassFee !== IMAGE_PASS_FEE_WEI ||
      !isAddress(String(treasury))
    ) {
      throw new Error("REGISTRY_IDENTITY_MISMATCH");
    }
  } catch (error) {
    if (error instanceof Error && error.message === "REGISTRY_IDENTITY_MISMATCH") {
      throw error;
    }
    throw new Error("REGISTRY_IDENTITY_MISMATCH", { cause: error });
  }
  if (imagePassFee === undefined) {
    throw new Error("REGISTRY_IDENTITY_MISMATCH");
  }
  assertExpectedTreasury(String(treasury), Boolean(options.requireExpectedTreasury));
  return {
    treasury: getAddress(String(treasury)),
    imagePassFee,
  };
}

export function assertExpectedTreasury(
  treasury: string,
  required: boolean,
  expectedTreasury = EXPECTED_TREASURY,
) {
  if (!required) return;
  if (!isAddress(expectedTreasury)) {
    throw new Error("TREASURY_NOT_CONFIGURED");
  }
  if (!isAddress(treasury) || getAddress(treasury) !== getAddress(expectedTreasury)) {
    throw new Error("TREASURY_MISMATCH");
  }
}

function toBigInt(value: unknown) {
  if (
    typeof value !== "bigint" &&
    typeof value !== "number" &&
    typeof value !== "string" &&
    typeof value !== "boolean"
  ) {
    throw new Error("BAD_BIGINT");
  }
  return BigInt(value);
}

export function toTimelineItem(event: EventLog): TimelineItem {
  const args = event.args;
  return {
    id: `${event.transactionHash}-${event.index}`,
    author: String(args.author),
    index: BigInt(args.index),
    createdAt: Number(args.createdAt),
    contentHash: String(args.contentHash),
    text: String(args.text),
    imageUri: String(args.imageUri ?? ""),
    imageHash: String(args.imageHash ?? ZERO_HASH),
    refHash: String(args.refHash ?? ZERO_HASH),
    refKind: Number(args.refKind ?? REF_KIND_NONE),
    txHash: event.transactionHash,
    blockNumber: event.blockNumber,
  };
}

export async function readSigcard(
  provider: JsonRpcProvider,
  contractAddress: string,
  address: string,
): Promise<Sigcard> {
  const contract = new Contract(contractAddress, ABI, provider);
  const [profile, postCount] = await Promise.all([
    contract.profile(address),
    contract.postCount(address),
  ]);
  return {
    address,
    nick: String(profile.nick ?? profile[0] ?? ""),
    twtUrl: String(profile.twtUrl ?? profile[1] ?? ""),
    updatedAt: Number(profile.updatedAt ?? profile[2] ?? 0),
    postCount: BigInt(postCount),
  };
}

export async function readImagePass(
  provider: JsonRpcProvider,
  contractAddress: string,
  address: string,
): Promise<boolean> {
  const contract = new Contract(contractAddress, ABI, provider);
  return Boolean(await contract.imagePasses(address));
}

export async function readLinePointer(
  provider: JsonRpcProvider,
  contractAddress: string,
  author: string,
  index: bigint,
): Promise<LinePointer> {
  const contract = new Contract(contractAddress, ABI, provider);
  const line = await contract.line(author, index);
  return {
    contentHash: String(line.contentHash ?? line[0] ?? ZERO_HASH),
    createdAt: Number(line.createdAt ?? line[1] ?? 0),
    imageHash: String(line.imageHash ?? line[2] ?? ZERO_HASH),
    refHash: String(line.refHash ?? line[3] ?? ZERO_HASH),
    refKind: Number(line.refKind ?? line[4] ?? REF_KIND_NONE),
  };
}

export function computePostContentHash(
  contractAddress: string,
  chainId: bigint,
  item: TimelineItem,
): string {
  return TypedDataEncoder.hash(
    {
      name: "Sigline",
      version: "1",
      chainId,
      verifyingContract: contractAddress,
    },
    POST_TYPES,
    {
      author: item.author,
      index: item.index,
      createdAt: item.createdAt,
      text: item.text,
      imageUri: item.imageUri,
      imageHash: item.imageHash,
      refHash: item.refHash,
      refKind: item.refKind,
    },
  );
}

export function readSavedSettings(): {
  networkKey: NetworkKey;
  contractsByNetwork: ContractMap;
  rpcUrl: string;
  proofRpcUrl?: string;
  fromBlock: string;
  nextScanBlock?: string;
  draftText?: string;
  draftReference?: DraftReference;
  draftQueue?: LocalDraft[];
  imageUploadMode?: string;
  imageUploadEndpoint?: string;
  imageGatewayMode?: string;
  scanScope?: string;
  feedSort?: string;
  trackedSigners?: string[];
  mutedSigners?: string[];
  mutedTerms?: string[];
  highlightedTerms?: string[];
  walletLabels?: WalletLabels;
  walletFlags?: WalletFlags;
  lineNotes?: LineNotes;
  lineMarks?: LineMarks;
  pinnedChannelsByScope?: Record<string, string[]>;
  circlesByScope?: Record<string, LocalCircle[]>;
  readerLensesByScope?: Record<string, ReaderLens[]>;
  readerSources?: ReaderSource[];
  profilePinsByScope?: Record<string, Record<string, ProfilePin>>;
  readLines?: string[];
  savedLines?: string[];
  savedLineCache?: Record<string, SavedLineRecord>;
  showMuted?: boolean;
} {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(STORAGE_KEY) || "{}",
    ) as Partial<{
      networkKey: NetworkKey;
      contractAddress: string;
      contractsByNetwork: ContractMap;
      rpcUrl: string;
      proofRpcUrl: string;
      fromBlock: string;
      nextScanBlock: string;
      draftText: string;
      draftReference: unknown;
      draftQueue: unknown[];
      imageUploadMode: string;
      imageUploadEndpoint: string;
      imageGatewayMode: string;
      scanScope: string;
      feedSort: string;
      trackedSigners: string[];
      mutedSigners: string[];
      mutedTerms: string[];
      highlightedTerms: unknown;
      walletLabels: unknown;
      walletFlags: unknown;
      lineNotes: unknown;
      lineMarks: unknown;
      pinnedChannelsByScope: Record<string, unknown>;
      circlesByScope: Record<string, unknown>;
      readerLensesByScope: Record<string, unknown>;
      readerSources: unknown[];
      profilePinsByScope: Record<string, unknown>;
      readLines: string[];
      savedLines: string[];
      savedLineCache: Record<string, unknown>;
      showMuted: boolean;
    }>;
    const networkKey = isNetworkKey(parsed.networkKey)
      ? parsed.networkKey
      : DEFAULT_NETWORK;
    const parsedContracts: Partial<ContractMap> =
      typeof parsed.contractsByNetwork === "object" && parsed.contractsByNetwork
        ? parsed.contractsByNetwork
        : {};
    const contractsByNetwork: ContractMap = {
      "base-sepolia":
        typeof parsedContracts["base-sepolia"] === "string"
          ? parsedContracts["base-sepolia"]
          : "",
      base: typeof parsedContracts.base === "string" ? parsedContracts.base : "",
    };
    if (
      typeof parsed.contractAddress === "string" &&
      !contractsByNetwork[networkKey]
    ) {
      contractsByNetwork[networkKey] = parsed.contractAddress;
    }
    if (DEFAULT_CONTRACT && !contractsByNetwork[DEFAULT_NETWORK]) {
      contractsByNetwork[DEFAULT_NETWORK] = DEFAULT_CONTRACT;
    }
    return {
      networkKey,
      contractsByNetwork,
      rpcUrl:
        typeof parsed.rpcUrl === "string" && parsed.rpcUrl.trim()
          ? parsed.rpcUrl
          : NETWORKS[networkKey].rpcUrl,
      proofRpcUrl:
        typeof parsed.proofRpcUrl === "string" ? parsed.proofRpcUrl : "",
      fromBlock:
        typeof parsed.fromBlock === "string"
          ? parsed.fromBlock
          : DEFAULT_FROM_BLOCK,
      nextScanBlock:
        typeof parsed.nextScanBlock === "string" ? parsed.nextScanBlock : "",
      draftText: typeof parsed.draftText === "string" ? parsed.draftText : "",
      draftReference: normalizeDraftReference(parsed.draftReference),
      draftQueue: normalizeDraftQueue(parsed.draftQueue),
      imageUploadMode:
        typeof parsed.imageUploadMode === "string"
          ? parsed.imageUploadMode
          : undefined,
      imageUploadEndpoint:
        typeof parsed.imageUploadEndpoint === "string"
          ? parsed.imageUploadEndpoint
          : undefined,
      imageGatewayMode:
        parsed.imageGatewayMode === "configured" ||
        parsed.imageGatewayMode === "fallbacks"
          ? parsed.imageGatewayMode
          : undefined,
      scanScope: typeof parsed.scanScope === "string" ? parsed.scanScope : undefined,
      feedSort: typeof parsed.feedSort === "string" ? parsed.feedSort : undefined,
      trackedSigners: readStringArray(parsed.trackedSigners),
      mutedSigners: readStringArray(parsed.mutedSigners),
      mutedTerms: normalizeMutedTerms(parsed.mutedTerms),
      highlightedTerms: normalizeHighlightTerms(parsed.highlightedTerms),
      walletLabels: normalizeWalletLabels(parsed.walletLabels),
      walletFlags: normalizeWalletFlags(parsed.walletFlags),
      lineNotes: normalizeLineNotes(parsed.lineNotes),
      lineMarks: normalizeLineMarks(parsed.lineMarks),
      pinnedChannelsByScope: readStringArrayRecord(parsed.pinnedChannelsByScope),
      circlesByScope: normalizeCirclesByScope(parsed.circlesByScope),
      readerLensesByScope: normalizeReaderLensesByScope(
        parsed.readerLensesByScope,
      ),
      readerSources: normalizeReaderSources(parsed.readerSources),
      profilePinsByScope: normalizeProfilePinsByScope(parsed.profilePinsByScope),
      readLines: normalizeLineHashes(parsed.readLines, MAX_READ_LINES),
      savedLines: readStringArray(parsed.savedLines),
      savedLineCache: normalizeSavedLineCache(parsed.savedLineCache),
      showMuted: Boolean(parsed.showMuted),
    };
  } catch {
    return {
      networkKey: DEFAULT_NETWORK,
      contractsByNetwork: {
        "base-sepolia":
          DEFAULT_NETWORK === "base-sepolia" ? DEFAULT_CONTRACT : "",
        base: DEFAULT_NETWORK === "base" ? DEFAULT_CONTRACT : "",
      },
      rpcUrl: DEFAULT_RPC,
      proofRpcUrl: "",
      fromBlock: DEFAULT_FROM_BLOCK,
      nextScanBlock: "",
      draftText: "",
      draftQueue: [],
      trackedSigners: [],
      mutedSigners: [],
      mutedTerms: [],
      highlightedTerms: [],
      walletLabels: {},
      walletFlags: {},
      lineNotes: {},
      lineMarks: {},
      pinnedChannelsByScope: {},
      circlesByScope: {},
      readerLensesByScope: {},
      readerSources: [],
      profilePinsByScope: {},
      readLines: [],
      savedLines: [],
      savedLineCache: {},
      showMuted: false,
    };
  }
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function readStringArrayRecord(value: unknown) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => Array.isArray(item))
      .map(([key, item]) => [key, readStringArray(item)]),
  );
}

export function normalizeMutedTerm(value: unknown) {
  if (typeof value !== "string") return "";
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  if (!normalized || toUtf8Bytes(normalized).length > MAX_MUTED_TERM_BYTES) {
    return "";
  }
  return normalized;
}

function normalizeMutedTerms(value: unknown) {
  const terms = new Set<string>();
  readStringArray(value).forEach((item) => {
    const normalized = normalizeMutedTerm(item);
    if (normalized) terms.add(normalized);
  });
  return [...terms].sort().slice(0, MAX_MUTED_TERMS);
}

function normalizeLineHashes(value: unknown, limit: number) {
  const hashes = new Set<string>();
  readStringArray(value).forEach((item) => {
    if (HEX_32_RE.test(item)) hashes.add(item.toLowerCase());
  });
  return [...hashes].slice(0, limit);
}

function normalizeSavedLineCache(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const cache: Record<string, SavedLineRecord> = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, raw]) => {
    const record = normalizeSavedLineRecord(raw);
    if (!record || key.toLowerCase() !== record.contentHash.toLowerCase()) return;
    cache[record.contentHash.toLowerCase()] = record;
  });
  return cache;
}

function normalizeSavedLineRecord(value: unknown): SavedLineRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Partial<SavedLineRecord>;
  const networkKey = raw.networkKey;
  if (!isNetworkKey(networkKey)) return undefined;
  if (!isAddress(String(raw.contractAddress ?? ""))) return undefined;
  if (!isAddress(String(raw.author ?? ""))) return undefined;
  const index = String(raw.index ?? "");
  let parsedIndex: bigint;
  try {
    parsedIndex = BigInt(index);
  } catch {
    return undefined;
  }
  const createdAt = Number(raw.createdAt);
  const blockNumber = Number(raw.blockNumber);
  const savedAt = Number(raw.savedAt);
  const refKind = Number(raw.refKind);
  if (parsedIndex < 0n) return undefined;
  if (!Number.isInteger(createdAt) || createdAt < 0) return undefined;
  if (!Number.isInteger(blockNumber) || blockNumber < 0) return undefined;
  if (!Number.isInteger(savedAt) || savedAt < 0) return undefined;
  if (![REF_KIND_NONE, REF_KIND_REPLY, REF_KIND_ECHO].includes(refKind)) {
    return undefined;
  }
  const contentHash = String(raw.contentHash ?? "");
  const imageHash = String(raw.imageHash ?? "");
  const refHash = String(raw.refHash ?? "");
  if (![contentHash, imageHash, refHash].every((item) => HEX_32_RE.test(item))) {
    return undefined;
  }
  const txHash = String(raw.txHash ?? "");
  if (!HEX_32_RE.test(txHash)) return undefined;
  const publicUrl = normalizePublicUrl(raw.publicUrl);
  return {
    networkKey,
    contractAddress: getAddress(String(raw.contractAddress)),
    savedAt,
    publicUrl,
    author: getAddress(String(raw.author)),
    index: parsedIndex.toString(),
    createdAt,
    contentHash: contentHash.toLowerCase(),
    text: String(raw.text ?? ""),
    imageUri: String(raw.imageUri ?? ""),
    imageHash: imageHash.toLowerCase(),
    refHash: refHash.toLowerCase(),
    refKind,
    txHash: txHash.toLowerCase(),
    blockNumber,
    proof: normalizeSavedLineProof(raw.proof),
  };
}

function normalizePublicUrl(value: unknown) {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function normalizeSavedLineProof(value: unknown): SavedLineRecord["proof"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Partial<Record<"sameRpc" | "independent" | "image", unknown>>;
  const proof = {
    sameRpc: normalizeSavedLineProofStatus(raw.sameRpc),
    independent: normalizeSavedLineProofStatus(raw.independent),
    image: normalizeSavedLineProofStatus(raw.image),
  };
  return proof.sameRpc || proof.independent || proof.image ? proof : undefined;
}

function normalizeSavedLineProofStatus(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Partial<SavedLineProofStatus>;
  if (!isStatusTone(raw.tone) || typeof raw.status !== "string") return undefined;
  return { tone: raw.tone, status: raw.status.slice(0, 80) };
}

function isStatusTone(value: unknown): value is StatusTone {
  return value === "idle" || value === "good" || value === "warn" || value === "bad";
}

function isNetworkKey(value: unknown): value is NetworkKey {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(NETWORKS, value)
  );
}

function normalizeDraftReference(value: unknown): DraftReference | undefined {
  if (!value || typeof value !== "object") return undefined;
  const draft = value as Partial<DraftReference>;
  const mode = draft.mode;
  const index = String(draft.index ?? "");
  let parsedIndex: bigint;
  try {
    parsedIndex = BigInt(index);
  } catch {
    return undefined;
  }
  const createdAt = Number(draft.createdAt);
  const blockNumber = Number(draft.blockNumber);
  const refKind = Number(draft.refKind);
  if (mode !== "reply" && mode !== "echo") return undefined;
  const networkKey = draft.networkKey;
  if (!isNetworkKey(networkKey)) return undefined;
  if (!isAddress(String(draft.contractAddress ?? ""))) return undefined;
  if (!isAddress(String(draft.author ?? ""))) return undefined;
  if (parsedIndex < 0n) return undefined;
  if (!Number.isInteger(createdAt) || createdAt < 0) return undefined;
  if (!Number.isInteger(blockNumber) || blockNumber < 0) return undefined;
  if (![REF_KIND_NONE, REF_KIND_REPLY, REF_KIND_ECHO].includes(refKind)) {
    return undefined;
  }
  const contentHash = String(draft.contentHash ?? "");
  const imageHash = String(draft.imageHash ?? "");
  const refHash = String(draft.refHash ?? "");
  if (![contentHash, imageHash, refHash].every((item) => HEX_32_RE.test(item))) {
    return undefined;
  }
  const txHash = String(draft.txHash ?? "");
  if (!HEX_32_RE.test(txHash)) return undefined;
  return {
    mode,
    networkKey,
    contractAddress: getAddress(String(draft.contractAddress)),
    author: getAddress(String(draft.author)),
    index: parsedIndex.toString(),
    createdAt,
    contentHash: contentHash.toLowerCase(),
    text: String(draft.text ?? ""),
    imageUri: String(draft.imageUri ?? ""),
    imageHash: imageHash.toLowerCase(),
    refHash: refHash.toLowerCase(),
    refKind,
    txHash: txHash.toLowerCase(),
    blockNumber,
  };
}

export function parseBlock(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error("BAD_START_BLOCK");
  return parsed;
}

export function shorten(value: string) {
  if (!value) return "";
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp * 1000));
}

export function formatRelative(timestamp: number) {
  const delta = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
  if (delta < 60) return `${delta}s`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m`;
  if (delta < 86_400) return `${Math.floor(delta / 3600)}h`;
  return `${Math.floor(delta / 86_400)}d`;
}

export function getDisplayErrorMessage(error: unknown) {
  const code =
    typeof error === "object" && error && "code" in error
      ? Number((error as { code: unknown }).code)
      : 0;
  if (code === 4001) return "Request rejected in wallet";
  if (error instanceof Error) {
    if (error.message === "NO_WALLET") return "No wallet detected";
    if (error.message === "WRONG_NETWORK")
      return "Signer is on the wrong network";
    if (error.message === "SIGNER_ACCOUNT_CHANGED")
      return "Wallet account changed. Review the account and try again";
    if (error.message === "REGISTRY_NOT_FOUND")
      return "No live registry at that address";
    if (error.message === "REGISTRY_IDENTITY_MISMATCH")
      return "Contract address is not a verified Sigline registry";
    if (error.message === "TREASURY_NOT_CONFIGURED")
      return "Expected treasury is not configured";
    if (error.message === "TREASURY_MISMATCH")
      return "Contract treasury does not match the configured treasury";
    if (error.message === "BAD_START_BLOCK")
      return "Start must be a non-negative block number";
  }
  if (typeof error === "object" && error && "shortMessage" in error) {
    const shortMessage = String(
      (error as { shortMessage: unknown }).shortMessage,
    ).toLowerCase();
    if (
      shortMessage.includes("user rejected") ||
      shortMessage.includes("denied")
    ) {
      return "Request rejected in wallet";
    }
    if (shortMessage.includes("insufficient funds")) {
      return "Insufficient funds for network fee";
    }
  }
  return "Request failed. Check wallet, network, and contract address.";
}

export function isAddressLike(value: string) {
  return isAddress(value);
}
