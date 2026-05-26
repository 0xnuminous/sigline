// Network configs, ABI, contract helpers, and chain-related utilities.
// Extracted from main.tsx with no behavior change so the UI layer stays thin.

import {
  BrowserProvider,
  Contract,
  EventLog,
  JsonRpcProvider,
  isAddress,
} from "ethers";

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
  txHash: string;
  blockNumber: number;
};

export type LinePointer = {
  contentHash: string;
  createdAt: number;
  imageHash: string;
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

export const MAX_POST_BYTES = 140;
export const MAX_IMAGE_BYTES = 1_000_000;
export const MAX_IMAGE_URI_BYTES = 256;
export const ZERO_HASH = `0x${"0".repeat(64)}`;

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
  "function post(string text, string imageUri, bytes32 imageHash) returns (uint256 index, bytes32 contentHash)",
  "function setProfile(string nick, string twtUrl)",
  "function line(address account, uint256 index) view returns (tuple(bytes32 contentHash, uint64 createdAt, bytes32 imageHash))",
  "function profile(address account) view returns (tuple(string nick, string twtUrl, uint64 updatedAt))",
  "function postCount(address account) view returns (uint256)",
  "event PostPosted(address indexed author, uint256 indexed index, uint64 indexed createdAt, bytes32 contentHash, string text, string imageUri, bytes32 imageHash)",
  "event ProfileUpdated(address indexed account, string nick, string twtUrl, uint64 updatedAt)",
];

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
) {
  if (!window.ethereum) throw new Error("NO_WALLET");
  const provider = new BrowserProvider(window.ethereum);
  const current = await provider.getNetwork();
  if (current.chainId !== network.chainId) throw new Error("WRONG_NETWORK");
  await assertContractDeployed(provider, contractAddress);
  const signer = await provider.getSigner();
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
  };
}

export function readSavedSettings(): {
  networkKey: NetworkKey;
  contractsByNetwork: ContractMap;
  rpcUrl: string;
  fromBlock: string;
  imageUploadMode?: string;
  imageUploadEndpoint?: string;
  scanScope?: string;
  trackedSigners?: string[];
  mutedSigners?: string[];
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
      fromBlock: string;
      imageUploadMode: string;
      imageUploadEndpoint: string;
      scanScope: string;
      trackedSigners: string[];
      mutedSigners: string[];
      showMuted: boolean;
    }>;
    const networkKey =
      parsed.networkKey && NETWORKS[parsed.networkKey]
        ? parsed.networkKey
        : DEFAULT_NETWORK;
    const contractsByNetwork: ContractMap = {
      "base-sepolia": parsed.contractsByNetwork?.["base-sepolia"] ?? "",
      base: parsed.contractsByNetwork?.base ?? "",
    };
    if (parsed.contractAddress && !contractsByNetwork[networkKey]) {
      contractsByNetwork[networkKey] = parsed.contractAddress;
    }
    if (DEFAULT_CONTRACT && !contractsByNetwork[DEFAULT_NETWORK]) {
      contractsByNetwork[DEFAULT_NETWORK] = DEFAULT_CONTRACT;
    }
    return {
      networkKey,
      contractsByNetwork,
      rpcUrl: parsed.rpcUrl ?? DEFAULT_RPC,
      fromBlock: parsed.fromBlock ?? DEFAULT_FROM_BLOCK,
      imageUploadMode: parsed.imageUploadMode,
      imageUploadEndpoint: parsed.imageUploadEndpoint,
      scanScope: parsed.scanScope,
      trackedSigners: Array.isArray(parsed.trackedSigners)
        ? parsed.trackedSigners
        : [],
      mutedSigners: Array.isArray(parsed.mutedSigners) ? parsed.mutedSigners : [],
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
      fromBlock: DEFAULT_FROM_BLOCK,
      trackedSigners: [],
      mutedSigners: [],
      showMuted: false,
    };
  }
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
    if (error.message === "REGISTRY_NOT_FOUND")
      return "No live registry at that address";
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
