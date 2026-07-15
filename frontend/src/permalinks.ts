import { getAddress, isAddress } from "ethers";
import { channelFromId, type ChannelId } from "./channels";
import { NETWORKS, type NetworkKey, type TimelineItem } from "./chain";
import type { FeedSort } from "./feed";

const BYTES32_RE = /^0x[a-fA-F0-9]{64}$/i;
const MAX_PERMALINK_HREF_LENGTH = 4096;
const MAX_APP_PATH_LENGTH = 256;

export type PublicReaderLinkMode = "all" | "media" | "refs";
export type PublicReaderLinkScope = "all" | "address";

export type LinePermalink = {
  networkKey?: NetworkKey;
  chainId?: string;
  contractAddress?: string;
  fromBlock?: string;
  lineHash?: string;
  author?: string;
  index?: string;
  txHash?: string;
  wantsThread: boolean;
  shouldAutoLoad: boolean;
};

export type PublicReaderLink = {
  isReaderLink: boolean;
  shouldAutoLoad: boolean;
  networkKey?: NetworkKey;
  chainId?: string;
  contractAddress?: string;
  fromBlock?: string;
  scanScope?: PublicReaderLinkScope;
  author?: string;
  feedMode?: PublicReaderLinkMode;
  feedSort?: FeedSort;
  selectedChannel?: ChannelId | "";
};

export type PublicReaderLinkInput = {
  networkKey: NetworkKey;
  contractAddress: string;
  fromBlock: string;
  scanScope: "all" | "tracked" | "address";
  targetAddress: string;
  feedMode: string;
  feedSort: FeedSort;
  selectedChannel: ChannelId | "";
};

export function parseLinePermalink(href: string): LinePermalink {
  if (href.length > MAX_PERMALINK_HREF_LENGTH) {
    return { wantsThread: false, shouldAutoLoad: false };
  }
  try {
    const url = new URL(href);
    const params = url.searchParams;
    const wantsThread =
      params.get("sigline") === "thread" || params.get("thread") === "1";
    const chainId = normalizeChainId(params.get("chainId"));
    const networkKey =
      normalizeNetworkKey(params.get("network") ?? params.get("net")) ??
      networkFromChainId(chainId);
    const contractAddress = normalizeAddress(params.get("contract"));
    const fromBlock = normalizeBlock(params.get("block") ?? params.get("from"));
    const lineHash = normalizeBytes32(
      params.get("contentHash") ??
        params.get("line") ??
        lineHashFromFragment(url.hash),
    );
    const author = normalizeAddress(params.get("author"));
    const index = normalizeBlock(params.get("index"));
    const txHash = normalizeBytes32(params.get("txHash") ?? params.get("tx"));
    return {
      networkKey,
      chainId,
      contractAddress,
      fromBlock,
      lineHash,
      author,
      index,
      txHash,
      wantsThread,
      shouldAutoLoad: Boolean(contractAddress && fromBlock && lineHash && author && index),
    };
  } catch {
    return { wantsThread: false, shouldAutoLoad: false };
  }
}

export function parsePublicReaderLink(href: string): PublicReaderLink {
  if (href.length > MAX_PERMALINK_HREF_LENGTH) {
    return { isReaderLink: false, shouldAutoLoad: false };
  }
  try {
    const url = new URL(href);
    const params = url.searchParams;
    const isReaderLink =
      params.get("sigline") === "feed" || params.get("sigline") === "reader";
    if (!isReaderLink) return { isReaderLink: false, shouldAutoLoad: false };

    const chainId = normalizeChainId(params.get("chainId"));
    const networkKey =
      normalizeNetworkKey(params.get("network") ?? params.get("net")) ??
      networkFromChainId(chainId);
    const contractAddress = normalizeAddress(params.get("contract"));
    const author = normalizeAddress(params.get("author"));
    const fromBlock = normalizeBlock(
      params.get("from") ?? params.get("start") ?? params.get("block"),
    );
    const feedMode = normalizePublicReaderMode(params.get("mode"));
    const selectedChannel = normalizeChannelId(params.get("channel"));
    const feedSort = params.get("sort") === "oldest" ? "oldest" : undefined;
    const scanScope = author ? "address" : "all";

    return {
      isReaderLink,
      shouldAutoLoad: Boolean(contractAddress),
      networkKey,
      chainId,
      contractAddress,
      fromBlock,
      scanScope,
      author,
      feedMode,
      feedSort,
      selectedChannel,
    };
  } catch {
    return { isReaderLink: false, shouldAutoLoad: false };
  }
}

export function buildLinePermalink(
  href: string,
  networkKey: NetworkKey,
  contractAddress: string,
  item: TimelineItem,
) {
  const url = appUrlFromHref(href);
  url.searchParams.set("sigline", "line");
  url.searchParams.set("v", "1");
  url.searchParams.set("chainId", NETWORKS[networkKey].chainId.toString());
  url.searchParams.set("network", networkKey);
  if (isAddress(contractAddress)) {
    url.searchParams.set("contract", getAddress(contractAddress));
  }
  url.searchParams.set("block", String(item.blockNumber));
  url.searchParams.set("author", getAddress(item.author));
  url.searchParams.set("index", item.index.toString());
  url.searchParams.set("contentHash", item.contentHash.toLowerCase());
  url.searchParams.set("txHash", item.txHash.toLowerCase());
  url.searchParams.delete("net");
  url.searchParams.delete("from");
  url.searchParams.delete("line");
  url.searchParams.delete("tx");
  url.hash = `line-${item.contentHash.slice(2).toLowerCase()}`;
  return url.toString();
}

export function buildThreadPermalink(
  href: string,
  networkKey: NetworkKey,
  contractAddress: string,
  item: TimelineItem,
) {
  const url = new URL(
    buildLinePermalink(href, networkKey, contractAddress, item),
  );
  url.searchParams.set("sigline", "thread");
  url.searchParams.set("thread", "1");
  return url.toString();
}

export function buildPublicReaderLink(href: string, input: PublicReaderLinkInput) {
  const url = appUrlFromHref(href);
  url.searchParams.set("sigline", "feed");
  url.searchParams.set("v", "1");
  url.searchParams.set("chainId", NETWORKS[input.networkKey].chainId.toString());
  url.searchParams.set("network", input.networkKey);

  if (isAddress(input.contractAddress)) {
    url.searchParams.set("contract", getAddress(input.contractAddress));
  }

  const fromBlock = normalizeBlock(input.fromBlock);
  if (fromBlock) {
    url.searchParams.set("from", fromBlock);
  }

  if (input.scanScope === "address" && isAddress(input.targetAddress)) {
    url.searchParams.set("author", getAddress(input.targetAddress));
    url.searchParams.set("scope", "address");
  }

  const feedMode = normalizePublicReaderMode(input.feedMode);
  if (feedMode && feedMode !== "all") {
    url.searchParams.set("mode", feedMode);
  }

  const selectedChannel = normalizeChannelId(input.selectedChannel);
  if (selectedChannel) {
    url.searchParams.set("channel", selectedChannel);
  }

  if (input.feedSort === "oldest") {
    url.searchParams.set("sort", "oldest");
  }

  url.hash = "deck";
  return url.toString();
}

function normalizeNetworkKey(value: string | null): NetworkKey | undefined {
  return value === "base" || value === "base-sepolia" ? value : undefined;
}

function normalizeAddress(value: string | null) {
  return value && isAddress(value) ? getAddress(value) : undefined;
}

function normalizeBlock(value: string | null) {
  return value && /^\d+$/.test(value) ? value : undefined;
}

function normalizeChainId(value: string | null) {
  return value && /^\d+$/.test(value) ? value : undefined;
}

function networkFromChainId(chainId: string | undefined): NetworkKey | undefined {
  return Object.values(NETWORKS).find(
    (network) => network.chainId.toString() === chainId,
  )?.key;
}

function normalizeBytes32(value: string | null) {
  return value && BYTES32_RE.test(value) ? value.toLowerCase() : undefined;
}

function lineHashFromFragment(hash: string) {
  const value = hash.startsWith("#line-") ? `0x${hash.slice(6)}` : "";
  return value || null;
}

function appUrlFromHref(href: string) {
  const current = new URL(href);
  const url = new URL(current.origin);
  const pathname =
    current.pathname &&
    !current.pathname.startsWith("//") &&
    current.pathname.length <= MAX_APP_PATH_LENGTH
      ? current.pathname
      : "/";
  url.pathname = pathname;
  return url;
}

function normalizePublicReaderMode(
  value: string | null,
): PublicReaderLinkMode | undefined {
  return value === "all" || value === "media" || value === "refs"
    ? value
    : undefined;
}

function normalizeChannelId(value: string | null) {
  return typeof value === "string" ? (channelFromId(value)?.id ?? "") : "";
}
