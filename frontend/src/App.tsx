// Base command-deck: composition layer for Sigline.
// Owns wallet/contract state; delegates visuals to the design-system primitives.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AtSign,
  BadgeCheck,
  CheckCheck,
  Copy,
  Cpu,
  Download,
  Fingerprint,
  ImagePlus,
  Power,
  Radio,
  RefreshCw,
  Satellite,
  Send,
  ShieldCheck,
  Signal,
  Terminal,
  Trash2,
  Users,
  Wallet,
  Zap,
} from "lucide-react";
import {
  BrowserProvider,
  Contract,
  EventLog,
  JsonRpcProvider,
  formatEther,
  getAddress,
} from "ethers";
import type { ContractEventName, Log } from "ethers";
import type { LinePointer } from "./chain";
import {
  ABI,
  ContractMap,
  DraftReference,
  DEFAULT_NETWORK,
  EXPECTED_TREASURY,
  IMAGE_PASS_FEE_WEI,
  MAX_MUTED_TERM_BYTES,
  MAX_MUTED_TERMS,
  MAX_POST_BYTES,
  MAX_READ_LINES,
  NetworkKey,
  NETWORKS,
  REF_KIND_ECHO,
  REF_KIND_NONE,
  REF_KIND_REPLY,
  SavedLineRecord,
  SavedLineProofStatus,
  STORAGE_KEY,
  Sigcard,
  StatusTone,
  TimelineItem,
  ZERO_HASH,
  assertSiglineContract,
  computePostContentHash,
  ensureWalletOnNetwork,
  formatRelative,
  formatTime,
  getDisplayErrorMessage,
  isAddressLike,
  normalizeMutedTerm,
  parseBlock,
  readImagePass,
  readLinePointer,
  readSigcard,
  readSavedSettings,
  samplePosts,
  shorten,
  switchOrAddNetwork,
  toTimelineItem,
  writableContract,
} from "./chain";
import {
  AsciiDivider,
  BootCursor,
  Button,
  FiberBackdrop,
  Field,
  Hex,
  Input,
  KV,
  LogLine,
  LogStream,
  Panel,
  Select,
  Skeleton,
  StatusBadge,
  StatusDot,
  Textarea,
  useBalance,
  useChainTelemetry,
  useTypewriter,
} from "./components";
import {
  FeedSort,
  attachBundleSignature,
  getBundleSignatureMessage,
  getFeedStats,
  getThreadChildrenByHash,
  lineNeedsCurrentCheck,
  MAX_FEED_BUNDLE_IMPORT_AUTHORS,
  parseFeedBundleImport,
  serializeFeedExport,
  serializeFollowPackExport,
  sortFeedRows,
  type FeedBundleImportResult,
  type ThreadChildren,
} from "./feed";
import { serializeFeedDigest } from "./digests";
import {
  ChannelId,
  channelScopeKey,
  lineMatchesChannel,
  mergePinnedChannels,
  normalizePinnedChannelsByScope,
  summarizeChannels,
} from "./channels";
import {
  circleIdFromName,
  circleMemberSet,
  circleScopeKey,
  deleteCircle,
  normalizeCircleName,
  normalizeCirclesByScope,
  removeAddressFromCircles,
  summarizeCircles,
  toggleCircleMember,
  upsertCircle,
} from "./circles";
import type { CircleId, LocalCircle } from "./circles";
import {
  createLocalDraft,
  deleteDraft,
  draftLabel,
  filterDraftsForScope,
  normalizeDraftQueue,
  upsertDraft,
} from "./drafts";
import type { LocalDraft } from "./drafts";
import {
  lineMentionsTarget,
  mentionTargetFromAddress,
  summarizeMentions,
} from "./mentions";
import {
  MAX_WALLET_LABEL_BYTES,
  getWalletLabel,
  normalizeWalletLabel,
  normalizeWalletLabels,
  setWalletLabel,
  type WalletLabels,
} from "./labels";
import {
  getWalletFlag,
  nextWalletFlag,
  normalizeWalletFlags,
  setWalletFlag,
  type WalletFlag,
  type WalletFlags,
} from "./walletFlags";
import {
  MAX_LINE_NOTE_BYTES,
  getLineNote,
  normalizeLineNote,
  normalizeLineNotes,
  setLineNote,
  type LineNotes,
} from "./notes";
import {
  getLineMark,
  nextLineMark,
  normalizeLineMarks,
  setLineMark,
  type LineMark,
  type LineMarks,
} from "./marks";
import {
  MAX_HIGHLIGHT_TERM_BYTES,
  MAX_HIGHLIGHT_TERMS,
  matchingHighlightTerms,
  normalizeHighlightTerm,
  normalizeHighlightTerms,
} from "./highlights";
import {
  MAX_READER_LENS_NAME_BYTES,
  deleteReaderLens,
  normalizeReaderLensName,
  normalizeReaderLensesByScope,
  readerLensIdFromName,
  readerLensScopeKey,
  upsertReaderLens,
  type ReaderLens,
} from "./lenses";
import {
  MAX_READER_SOURCE_NAME_BYTES,
  deleteReaderSource,
  makeReaderSource,
  normalizeReaderSourceName,
  normalizeReaderSources,
  serializeReaderSources,
  upsertReaderSource,
  type ReaderSource,
} from "./readerSources";
import {
  DEFAULT_IMAGE_GATEWAY_MODE,
  DEFAULT_IMAGE_UPLOAD_ENDPOINT,
  DEFAULT_IMAGE_UPLOAD_MODE,
  ImageGatewayMode,
  ImageUploadMode,
  ImageUploadResult,
  imageUriToGateway,
  uploadImage,
  validateImageFile,
  verifyImageUri,
} from "./uploads";
import {
  buildLinePermalink,
  buildPublicReaderLink,
  buildThreadPermalink,
  parseLinePermalink,
  parsePublicReaderLink,
} from "./permalinks";
import {
  ProfilePin,
  ProfileEventItem,
  ProfileWatch,
  getProfilePinStatus,
  makeProfilePin,
  normalizeProfilePinsByScope,
  profilePinScopeKey,
  summarizeProfileWatches,
  toProfileEventItem,
} from "./profiles";
import {
  exportEncryptedVault,
  formatSettingsImportSummary,
  importEncryptedVault,
} from "./vault";
import {
  FeedProvenance,
  summarizeFeedProvenance,
} from "./provenance";
import {
  canonicalizeRpcEndpoint,
  doRpcEndpointsShareOrigin,
} from "./rpcIdentity";

type ScanScope = "all" | "tracked" | "address";
type FeedMode =
  | "all"
  | "unread"
  | "mentions"
  | "media"
  | "refs"
  | "saved"
  | "marked"
  | "highlighted"
  | "flagged"
  | "checked"
  | "needs-check";
type ScanOptions = {
  startBlock?: string;
  endBlock?: string;
  merge?: boolean;
  older?: boolean;
};
type LineAudit = {
  tone: StatusTone;
  text: string;
  detail?: string;
};
type PointerAuditResult =
  | { ok: true }
  | { ok: false; text: "not found" | "mismatch"; detail: string };
type BundleImportPreview = {
  result: FeedBundleImportResult;
  checkedAt: number;
};
type DraftImagePointer = {
  uri: string;
  hash: string;
};

type SigcardView = Sigcard & {
  latestAt: number;
  visibleCount: number;
  localLabel: string;
  localFlag: WalletFlag | "";
  profilePin?: ProfilePin;
  profilePinStatus: ReturnType<typeof getProfilePinStatus>;
  error?: string;
  profileWatch?: ProfileWatch;
};

const LOG_CHUNK_SIZE = 2_000;
const TIMELINE_LIMIT = 40;
const PROOF_BATCH_LIMIT = 10;
const INITIAL_SCAN_BLOCK_WINDOW = 10_000;
const NEWER_SCAN_BLOCK_WINDOW = 10_000;
const THREAD_SCAN_BLOCK_WINDOW = 10_000;
const PROFILE_SCAN_BLOCK_WINDOW = 100_000;
const PROFILE_EVENT_LIMIT = 200;

const ASCII_TITLE = `
 ███████╗██╗ ██████╗ ██╗     ██╗███╗   ██╗███████╗
 ██╔════╝██║██╔════╝ ██║     ██║████╗  ██║██╔════╝
 ███████╗██║██║  ███╗██║     ██║██╔██╗ ██║█████╗
 ╚════██║██║██║   ██║██║     ██║██║╚██╗██║██╔══╝
 ███████║██║╚██████╔╝███████╗██║██║ ╚████║███████╗
 ╚══════╝╚═╝ ╚═════╝ ╚══════╝╚═╝╚═╝  ╚═══╝╚══════╝
`.replace(/^\n/, "");

function draftReferenceToTimelineItem(
  reference: DraftReference,
): TimelineItem | null {
  try {
    return {
      id: `draft-${reference.mode}-${reference.contentHash}`,
      author: getAddress(reference.author),
      index: BigInt(reference.index),
      createdAt: reference.createdAt,
      contentHash: reference.contentHash,
      text: reference.text,
      imageUri: reference.imageUri,
      imageHash: reference.imageHash,
      refHash: reference.refHash,
      refKind: reference.refKind,
      txHash: reference.txHash,
      blockNumber: reference.blockNumber,
    };
  } catch {
    return null;
  }
}

function timelineItemToDraftReference(
  item: TimelineItem,
  mode: DraftReference["mode"],
  networkKey: NetworkKey,
  contractAddress: string,
): DraftReference {
  return {
    mode,
    networkKey,
    contractAddress,
    author: item.author,
    index: item.index.toString(),
    createdAt: item.createdAt,
    contentHash: item.contentHash,
    text: item.text,
    imageUri: item.imageUri,
    imageHash: item.imageHash,
    refHash: item.refHash,
    refKind: item.refKind,
    txHash: item.txHash,
    blockNumber: item.blockNumber,
  };
}

function savedLineRecordToTimelineItem(record: SavedLineRecord): TimelineItem {
  return {
    id: `saved-${record.contentHash}`,
    author: record.author,
    index: BigInt(record.index),
    createdAt: record.createdAt,
    contentHash: record.contentHash,
    text: record.text,
    imageUri: record.imageUri,
    imageHash: record.imageHash,
    refHash: record.refHash,
    refKind: record.refKind,
    txHash: record.txHash,
    blockNumber: record.blockNumber,
  };
}

function timelineItemToSavedLineRecord({
  item,
  networkKey,
  contractAddress,
  publicUrl,
  proof,
}: {
  item: TimelineItem;
  networkKey: NetworkKey;
  contractAddress: string;
  publicUrl: string;
  proof?: SavedLineRecord["proof"];
}): SavedLineRecord {
  return {
    networkKey,
    contractAddress,
    savedAt: Date.now(),
    publicUrl,
    author: item.author,
    index: item.index.toString(),
    createdAt: item.createdAt,
    contentHash: item.contentHash.toLowerCase(),
    text: item.text,
    imageUri: item.imageUri,
    imageHash: item.imageHash.toLowerCase(),
    refHash: item.refHash.toLowerCase(),
    refKind: item.refKind,
    txHash: item.txHash.toLowerCase(),
    blockNumber: item.blockNumber,
    proof,
  };
}

function savedLineScopeMatches(
  record: SavedLineRecord,
  networkKey: NetworkKey,
  contractAddress: string,
) {
  return (
    record.networkKey === networkKey &&
    record.contractAddress.toLowerCase() === contractAddress.toLowerCase()
  );
}

function auditToSavedProofStatus(audit?: LineAudit) {
  return audit ? { tone: audit.tone, status: audit.text } : undefined;
}

function savedProofStatusToAudit(status?: SavedLineProofStatus): LineAudit | undefined {
  return status ? { tone: status.tone, text: status.status } : undefined;
}

function bundleImportSourceLabel(result: FeedBundleImportResult) {
  return result.schema === "sigline.followPack.v1"
    ? "follow pack"
    : `${result.lineCount} bundled line${result.lineCount === 1 ? "" : "s"}`;
}

function bundleImportSignatureLabel(result: FeedBundleImportResult) {
  return result.signature
    ? `signed by ${shorten(result.signature.signer)}`
    : "unsigned";
}

function getPointerAuditResult(
  item: TimelineItem,
  pointer: LinePointer,
  contractAddress: string,
  chainId: bigint,
): PointerAuditResult {
  const pointerMissing =
    pointer.contentHash.toLowerCase() === ZERO_HASH &&
    pointer.createdAt === 0 &&
    pointer.imageHash.toLowerCase() === ZERO_HASH &&
    pointer.refHash.toLowerCase() === ZERO_HASH &&
    pointer.refKind === REF_KIND_NONE;
  if (pointerMissing) {
    return {
      ok: false,
      text: "not found",
      detail: "No stored line pointer for this author/index.",
    };
  }
  const mismatches = [
    pointer.contentHash.toLowerCase() !== item.contentHash.toLowerCase()
      ? "content hash"
      : "",
    computePostContentHash(contractAddress, chainId, item).toLowerCase() !==
    item.contentHash.toLowerCase()
      ? "displayed content"
      : "",
    pointer.createdAt !== item.createdAt ? "timestamp" : "",
    pointer.imageHash.toLowerCase() !== item.imageHash.toLowerCase()
      ? "image hash"
      : "",
    pointer.refHash.toLowerCase() !== item.refHash.toLowerCase()
      ? "reference"
      : "",
    pointer.refKind !== item.refKind ? "reference kind" : "",
  ].filter(Boolean);
  if (mismatches.length) {
    return {
      ok: false,
      text: "mismatch",
      detail: `Line audit mismatch: ${mismatches.join(", ")}.`,
    };
  }
  return { ok: true };
}

async function verifyLineWithProvider(
  provider: JsonRpcProvider,
  contractAddress: string,
  network: (typeof NETWORKS)[NetworkKey],
  item: TimelineItem,
  options: { contractChecked?: boolean } = {},
) {
  if (!options.contractChecked) {
    await assertSiglineContract(provider, contractAddress, network);
  }
  const pointer = await readLinePointer(
    provider,
    contractAddress,
    item.author,
    item.index,
  );
  const pointerAudit = getPointerAuditResult(
    item,
    pointer,
    contractAddress,
    network.chainId,
  );
  if (!pointerAudit.ok) throw new Error(pointerAudit.detail);
  const receipt = await provider.getTransactionReceipt(item.txHash);
  if (!receipt) throw new Error("Transaction receipt was not found.");
  if (receipt.status === 0) throw new Error("Transaction receipt failed.");
  const contract = new Contract(contractAddress, ABI, provider);
  const events = await contract.queryFilter(
    contract.filters.PostPosted(item.author, item.index),
    receipt.blockNumber,
    receipt.blockNumber,
  );
  const eventItem = events
    .filter((event): event is EventLog => event instanceof EventLog)
    .map((event) => toTimelineItem(event))
    .find(
      (candidate) =>
        candidate.txHash.toLowerCase() === item.txHash.toLowerCase() &&
        candidate.contentHash.toLowerCase() === item.contentHash.toLowerCase(),
    );
  if (!eventItem) throw new Error("Matching event was not found.");
  if (
    computePostContentHash(
      contractAddress,
      network.chainId,
      eventItem,
    ).toLowerCase() !== item.contentHash.toLowerCase()
  ) {
    throw new Error("Event content commitment mismatch.");
  }
}

function draftReferenceMatchesScope(
  reference: DraftReference | undefined,
  networkKey: NetworkKey,
  contractAddress: string,
) {
  if (!reference) return false;
  return (
    reference.networkKey === networkKey &&
    reference.contractAddress.toLowerCase() === contractAddress.toLowerCase()
  );
}

function mergeReadLineHashes(current: string[], additions: string[]) {
  const seen = new Set<string>();
  const merged: string[] = [];
  [...additions, ...current].forEach((value) => {
    const normalized = value.toLowerCase();
    if (!/^0x[a-f0-9]{64}$/.test(normalized) || seen.has(normalized)) return;
    seen.add(normalized);
    merged.push(normalized);
  });
  return merged.slice(0, MAX_READ_LINES);
}

export default function App() {
  const permalink = useMemo(
    () => parseLinePermalink(window.location.href),
    [],
  );
  const publicReaderLink = useMemo(
    () => parsePublicReaderLink(window.location.href),
    [],
  );
  const saved = useMemo(readSavedSettings, []);
  const initialNetworkKey =
    permalink.networkKey ??
    publicReaderLink.networkKey ??
    (publicReaderLink.isReaderLink ? DEFAULT_NETWORK : saved.networkKey);
  const initialPermalinkContract =
    permalink.contractAddress ?? publicReaderLink.contractAddress;
  const initialContractsByNetwork = publicReaderLink.isReaderLink
    ? {
        ...saved.contractsByNetwork,
        [initialNetworkKey]: initialPermalinkContract ?? "",
      }
    : {
        ...saved.contractsByNetwork,
        ...(initialPermalinkContract
          ? { [initialNetworkKey]: initialPermalinkContract }
          : {}),
      };
  const initialContractAddress = initialContractsByNetwork[initialNetworkKey];
  const savedDraftReference =
    saved.draftReference &&
    draftReferenceMatchesScope(
      saved.draftReference,
      initialNetworkKey,
      initialContractAddress,
    )
      ? draftReferenceToTimelineItem(saved.draftReference)
      : null;
  const [networkKey, setNetworkKey] = useState<NetworkKey>(initialNetworkKey);
  const network = NETWORKS[networkKey];
  const [contractsByNetwork, setContractsByNetwork] = useState<ContractMap>(
    initialContractsByNetwork,
  );
  const contractAddress = contractsByNetwork[networkKey];
  const permalinkLineHash = permalink.lineHash ?? "";
  const permalinkAuthor = permalink.author ?? "";
  const permalinkIndex = permalink.index ?? "";
  const permalinkFromBlock = permalink.fromBlock ?? "";
  const permalinkTxHash = permalink.txHash ?? "";
  const permalinkWantsThread = permalink.wantsThread;
  const permalinkShouldAutoLoad = permalink.shouldAutoLoad;
  const [rpcUrl, setRpcUrl] = useState(
    permalink.networkKey || publicReaderLink.isReaderLink
      ? NETWORKS[initialNetworkKey].rpcUrl
      : saved.rpcUrl,
  );
  const [proofRpcUrl, setProofRpcUrl] = useState(saved.proofRpcUrl ?? "");
  const [fromBlock, setFromBlock] = useState(
    permalink.fromBlock ??
      (publicReaderLink.isReaderLink
        ? (publicReaderLink.fromBlock ?? "")
        : saved.fromBlock),
  );
  const [account, setAccount] = useState("");
  const [walletChain, setWalletChain] = useState<bigint | null>(null);
  const [status, setStatus] = useState<{ tone: StatusTone; text: string }>({
    tone: "idle",
    text: "Ready. Connect a wallet to start posting.",
  });
  const [postText, setPostText] = useState(saved.draftText ?? "");
  const [nick, setNick] = useState("");
  const [twtUrl, setTwtUrl] = useState("");
  const [targetAddress, setTargetAddress] = useState(
    permalink.author ?? publicReaderLink.author ?? "",
  );
  const [scanScope, setScanScope] = useState<ScanScope>(
    permalink.author
      ? "address"
      : publicReaderLink.scanScope
        ? publicReaderLink.scanScope
        : saved.scanScope === "tracked" || saved.scanScope === "address"
          ? saved.scanScope
          : "all",
  );
  const [trackedSigners, setTrackedSigners] = useState<string[]>(() =>
    (saved.trackedSigners ?? [])
      .filter((value) => isAddressLike(value))
      .map((value) => getAddress(value)),
  );
  const [mutedSigners, setMutedSigners] = useState<string[]>(() =>
    (saved.mutedSigners ?? [])
      .filter((value) => isAddressLike(value))
      .map((value) => getAddress(value)),
  );
  const [mutedTerms, setMutedTerms] = useState<string[]>(saved.mutedTerms ?? []);
  const [muteTermInput, setMuteTermInput] = useState("");
  const [highlightedTerms, setHighlightedTerms] = useState<string[]>(() =>
    normalizeHighlightTerms(saved.highlightedTerms ?? []),
  );
  const [highlightTermInput, setHighlightTermInput] = useState("");
  const [walletLabels, setWalletLabels] = useState<WalletLabels>(() =>
    normalizeWalletLabels(saved.walletLabels ?? {}),
  );
  const [walletFlags, setWalletFlags] = useState<WalletFlags>(() =>
    normalizeWalletFlags(saved.walletFlags ?? {}),
  );
  const [labelAddressInput, setLabelAddressInput] = useState("");
  const [labelTextInput, setLabelTextInput] = useState("");
  const [pinnedChannelsByScope, setPinnedChannelsByScope] = useState<
    Record<string, ChannelId[]>
  >(() =>
    normalizePinnedChannelsByScope(saved.pinnedChannelsByScope ?? {}),
  );
  const [selectedChannel, setSelectedChannel] = useState<ChannelId | "">(
    publicReaderLink.selectedChannel ?? "",
  );
  const [circlesByScope, setCirclesByScope] = useState<
    Record<string, LocalCircle[]>
  >(() => normalizeCirclesByScope(saved.circlesByScope ?? {}));
  const [selectedCircle, setSelectedCircle] = useState<CircleId | "">("");
  const [circleNameInput, setCircleNameInput] = useState("");
  const [readerLensesByScope, setReaderLensesByScope] = useState<
    Record<string, ReaderLens[]>
  >(() => normalizeReaderLensesByScope(saved.readerLensesByScope ?? {}));
  const [readerLensNameInput, setReaderLensNameInput] = useState("");
  const [readerSources, setReaderSources] = useState<ReaderSource[]>(() =>
    normalizeReaderSources(saved.readerSources ?? []),
  );
  const [readerSourceNameInput, setReaderSourceNameInput] = useState("");
  const [profilePinsByScope, setProfilePinsByScope] = useState<
    Record<string, Record<string, ProfilePin>>
  >(() => normalizeProfilePinsByScope(saved.profilePinsByScope ?? {}));
  const [readLines, setReadLines] = useState<string[]>(() =>
    mergeReadLineHashes([], saved.readLines ?? []),
  );
  const [lineNotes, setLineNotes] = useState<LineNotes>(() =>
    normalizeLineNotes(saved.lineNotes ?? {}),
  );
  const [lineMarks, setLineMarks] = useState<LineMarks>(() =>
    normalizeLineMarks(saved.lineMarks ?? {}),
  );
  const [editingNoteHash, setEditingNoteHash] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [vaultPassphrase, setVaultPassphrase] = useState("");
  const [vaultPassphraseConfirm, setVaultPassphraseConfirm] = useState("");
  const [vaultImportText, setVaultImportText] = useState("");
  const [isVaultBusy, setIsVaultBusy] = useState(false);
  const [savedLines, setSavedLines] = useState<string[]>(() =>
    (saved.savedLines ?? [])
      .filter((value) => /^0x[a-fA-F0-9]{64}$/.test(value))
      .map((value) => value.toLowerCase()),
  );
  const [savedLineCache, setSavedLineCache] = useState<
    Record<string, SavedLineRecord>
  >(saved.savedLineCache ?? {});
  const [draftQueue, setDraftQueue] = useState<LocalDraft[]>(() =>
    normalizeDraftQueue(saved.draftQueue ?? []),
  );
  const [activeDraftId, setActiveDraftId] = useState("");
  const [showMuted, setShowMuted] = useState(Boolean(saved.showMuted));
  const [feedQuery, setFeedQuery] = useState("");
  const [feedMode, setFeedMode] = useState<FeedMode>(
    publicReaderLink.feedMode ?? "all",
  );
  const [feedSort, setFeedSort] = useState<FeedSort>(
    publicReaderLink.isReaderLink
      ? (publicReaderLink.feedSort ?? "newest")
      : saved.feedSort === "oldest"
        ? "oldest"
        : "newest",
  );
  const [readerControlsOpen, setReaderControlsOpen] = useState(false);
  const [bundleImportOpen, setBundleImportOpen] = useState(false);
  const [bundleImportText, setBundleImportText] = useState("");
  const [bundleImportPreview, setBundleImportPreview] =
    useState<BundleImportPreview | null>(null);
  const [bundleImportError, setBundleImportError] = useState("");
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [nextScanBlock, setNextScanBlock] = useState(
    permalink.fromBlock || publicReaderLink.isReaderLink
      ? ""
      : saved.nextScanBlock ?? "",
  );
  const [olderScanBlock, setOlderScanBlock] = useState("");
  const [sigcards, setSigcards] = useState<Record<string, Sigcard>>({});
  const [sigcardErrors, setSigcardErrors] = useState<Record<string, string>>({});
  const [profileWatches, setProfileWatches] = useState<
    Record<string, ProfileWatch>
  >({});
  const [isLoadingSigcards, setIsLoadingSigcards] = useState(false);
  const [sigcardRefresh, setSigcardRefresh] = useState(0);
  const [answeringTo, setAnsweringTo] = useState<TimelineItem | null>(() =>
    saved.draftReference?.mode === "reply" ? savedDraftReference : null,
  );
  const [echoingTo, setEchoingTo] = useState<TimelineItem | null>(() =>
    saved.draftReference?.mode === "echo" ? savedDraftReference : null,
  );
  const [hasQueriedTimeline, setHasQueriedTimeline] = useState(false);
  const [feedError, setFeedError] = useState("");
  const [feedProvenance, setFeedProvenance] = useState<FeedProvenance | null>(
    null,
  );
  const [lineAudits, setLineAudits] = useState<Record<string, LineAudit>>({});
  const [proofAudits, setProofAudits] = useState<Record<string, LineAudit>>({});
  const [imageAudits, setImageAudits] = useState<Record<string, LineAudit>>({});
  const [threadLoadingHash, setThreadLoadingHash] = useState("");
  const [threadLoadedHashes, setThreadLoadedHashes] = useState<
    Record<string, number>
  >({});
  const [verifiedImageUrls, setVerifiedImageUrls] = useState<
    Record<string, string>
  >({});
  const [isLoading, setIsLoading] = useState(false);
  const [isVerifyingFeed, setIsVerifyingFeed] = useState(false);
  const [isProofingFeed, setIsProofingFeed] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isBuyingImagePass, setIsBuyingImagePass] = useState(false);
  const [isSealingId, setIsSealingId] = useState(false);
  const [identityAction, setIdentityAction] = useState<"save" | "clear" | "">("");
  const [hasImagePass, setHasImagePass] = useState(false);
  const [imagePassLoading, setImagePassLoading] = useState(false);
  const [imagePassRefresh, setImagePassRefresh] = useState(0);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState("");
  const [imageUpload, setImageUpload] = useState<ImageUploadResult | null>(null);
  const [draftImagePointer, setDraftImagePointer] =
    useState<DraftImagePointer | null>(null);
  const [imageUploadMode, setImageUploadMode] = useState<ImageUploadMode>(
    saved.imageUploadMode === "endpoint" || saved.imageUploadMode === "local-ipfs"
      ? saved.imageUploadMode
      : DEFAULT_IMAGE_UPLOAD_MODE,
  );
  const [imageUploadEndpoint, setImageUploadEndpoint] = useState(
    saved.imageUploadEndpoint || DEFAULT_IMAGE_UPLOAD_ENDPOINT,
  );
  const [imageGatewayMode, setImageGatewayMode] = useState<ImageGatewayMode>(
    saved.imageGatewayMode === "configured" ||
      saved.imageGatewayMode === "fallbacks"
      ? saved.imageGatewayMode
      : DEFAULT_IMAGE_GATEWAY_MODE,
  );
  const [lastTx, setLastTx] = useState("");
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [balanceRefresh, setBalanceRefresh] = useState(0);
  // Counters that drive the one-shot green border flash on success.
  const [postFlash, setPostFlash] = useState(0);
  const [idFlash, setIdFlash] = useState(0);
  const [scanFlash, setScanFlash] = useState(0);
  const logSeq = useRef(0);
  const bootLogged = useRef(false);
  const permalinkAutoloadedRef = useRef(false);
  const permalinkThreadAutoloadedRef = useRef(false);
  const publicReaderAutoloadedRef = useRef(false);
  const scanRequestRef = useRef(0);
  const threadRequestRef = useRef(0);
  const feedVerifyRequestRef = useRef(0);
  const lineAuditGenerationRef = useRef(0);
  const proofAuditGenerationRef = useRef(0);
  const imageAuditGenerationRef = useRef(0);
  const imageSelectionGenerationRef = useRef(0);
  const draftImageVerificationRef = useRef(0);
  const imagePassPurchaseRef = useRef(0);
  const publishRequestRef = useRef(0);
  const identityRequestRef = useRef(0);
  const verifiedImageUrlsRef = useRef<Record<string, string>>({});
  const composeScopeRef = useRef(
    `${networkKey}:${contractAddress.toLowerCase()}`,
  );
  const profilePinScope = useMemo(
    () => profilePinScopeKey(networkKey, network.chainId, contractAddress),
    [contractAddress, network.chainId, networkKey],
  );
  const profilePins = useMemo(
    () => (profilePinScope ? (profilePinsByScope[profilePinScope] ?? {}) : {}),
    [profilePinScope, profilePinsByScope],
  );

  const appendLog = useCallback(
    (tone: StatusTone, text: string, tag?: string) => {
      logSeq.current += 1;
      const line: LogLine = {
        id: `log-${logSeq.current}`,
        ts: Date.now(),
        tone,
        text,
        tag,
      };
      setLogs((current) => {
        const next = [...current, line];
        return next.slice(-80);
      });
    },
    [],
  );

  const walletLabelFor = useCallback(
    (address: string) => getWalletLabel(walletLabels, address),
    [walletLabels],
  );

  const walletFlagFor = useCallback(
    (address: string) => getWalletFlag(walletFlags, address),
    [walletFlags],
  );

  const lineNoteForHash = useCallback(
    (contentHash: string) => getLineNote(lineNotes, contentHash),
    [lineNotes],
  );

  const lineMarkForHash = useCallback(
    (contentHash: string) => getLineMark(lineMarks, contentHash),
    [lineMarks],
  );

  const stageWalletLabel = useCallback(
    (address: string) => {
      if (!isAddressLike(address)) return;
      const normalized = getAddress(address);
      setLabelAddressInput(normalized);
      setLabelTextInput(getWalletLabel(walletLabels, normalized));
      document
        .getElementById("wallet-label-editor")
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    },
    [walletLabels],
  );

  const saveWalletLabel = useCallback(
    (address: string, label: string) => {
      if (!isAddressLike(address)) {
        setStatus({ tone: "bad", text: "Enter a valid wallet address to label." });
        return;
      }
      const normalizedLabel = normalizeWalletLabel(label);
      if (!normalizedLabel) {
        setStatus({
          tone: "bad",
          text: `Label must be non-empty and ${MAX_WALLET_LABEL_BYTES} UTF-8 bytes or less.`,
        });
        return;
      }
      const normalizedAddress = getAddress(address);
      setWalletLabels((current) =>
        setWalletLabel(current, normalizedAddress, normalizedLabel),
      );
      setLabelAddressInput(normalizedAddress);
      setLabelTextInput(normalizedLabel);
      setStatus({ tone: "good", text: "Saved private wallet label." });
      appendLog("good", `Labeled ${shorten(normalizedAddress)} locally.`, "label");
    },
    [appendLog],
  );

  const clearWalletLabel = useCallback(
    (address: string) => {
      if (!isAddressLike(address)) {
        setStatus({ tone: "bad", text: "Enter a valid wallet address to clear." });
        return;
      }
      const normalizedAddress = getAddress(address);
      setWalletLabels((current) => setWalletLabel(current, normalizedAddress, ""));
      setLabelAddressInput(normalizedAddress);
      setLabelTextInput("");
      setStatus({ tone: "good", text: "Cleared private wallet label." });
      appendLog("good", `Cleared local label for ${shorten(normalizedAddress)}.`, "label");
    },
    [appendLog],
  );

  const toggleWalletFlag = useCallback(
    (address: string) => {
      if (!isAddressLike(address)) {
        setStatus({ tone: "bad", text: "Enter a valid wallet address to flag." });
        return;
      }
      const normalizedAddress = getAddress(address);
      const nextFlag = nextWalletFlag(getWalletFlag(walletFlags, normalizedAddress));
      setWalletFlags((current) =>
        setWalletFlag(current, normalizedAddress, nextFlag),
      );
      setStatus({
        tone:
          nextFlag === "blocked"
            ? "warn"
            : nextFlag === "trusted"
              ? "good"
              : "idle",
        text: nextFlag
          ? `Flagged ${shorten(normalizedAddress)} as ${nextFlag} locally.`
          : `Cleared local flag for ${shorten(normalizedAddress)}.`,
      });
      appendLog(
        nextFlag === "blocked" ? "warn" : nextFlag === "trusted" ? "good" : "idle",
        nextFlag
          ? `Flagged wallet ${shorten(normalizedAddress)} as ${nextFlag}.`
          : `Cleared wallet flag for ${shorten(normalizedAddress)}.`,
        "flag",
      );
    },
    [appendLog, walletFlags],
  );

  const pinSigcardProfile = useCallback(
    (card: SigcardView) => {
      if (!profilePinScope) {
        setStatus({
          tone: "warn",
          text: "Set a contract address before pinning a profile.",
        });
        return;
      }
      if (card.error) {
        setStatus({
          tone: "warn",
          text: "Current sigcard profile is unavailable; keeping the existing pin.",
        });
        appendLog(
          "warn",
          `Skipped profile pin for ${shorten(card.address)} because the sigcard could not be read.`,
          "pin",
        );
        return;
      }
      const pin = makeProfilePin({
        address: card.address,
        nick: card.nick,
        twtUrl: card.twtUrl,
        updatedAt: card.updatedAt,
      });
      if (!pin) {
        setStatus({ tone: "bad", text: "Current sigcard profile cannot be pinned." });
        return;
      }
      setProfilePinsByScope((current) => ({
        ...current,
        [profilePinScope]: {
          ...(current[profilePinScope] ?? {}),
          [pin.address.toLowerCase()]: pin,
        },
      }));
      setStatus({
        tone: "good",
        text: `Pinned profile for ${shorten(card.address)} locally.`,
      });
      appendLog("good", `Pinned sigcard profile for ${shorten(card.address)}.`, "pin");
    },
    [appendLog, profilePinScope],
  );

  const clearSigcardProfilePin = useCallback(
    (address: string) => {
      if (!profilePinScope || !isAddressLike(address)) return;
      const normalized = getAddress(address).toLowerCase();
      setProfilePinsByScope((current) => {
        const scoped = { ...(current[profilePinScope] ?? {}) };
        delete scoped[normalized];
        return {
          ...current,
          [profilePinScope]: scoped,
        };
      });
      setStatus({
        tone: "idle",
        text: `Cleared profile pin for ${shorten(address)}.`,
      });
      appendLog("idle", `Cleared sigcard profile pin for ${shorten(address)}.`, "pin");
    },
    [appendLog, profilePinScope],
  );

  const stageLineNote = useCallback(
    (item: TimelineItem) => {
      const key = item.contentHash.toLowerCase();
      setEditingNoteHash(key);
      setNoteDraft(getLineNote(lineNotes, key));
      window.setTimeout(() => {
        document
          .getElementById(`note-${key.slice(2)}`)
          ?.scrollIntoView({ block: "center", behavior: "smooth" });
      }, 0);
    },
    [lineNotes],
  );

  const saveLineNote = useCallback(
    (item: TimelineItem, note: string) => {
      const normalized = normalizeLineNote(note);
      if (!normalized) {
        setStatus({
          tone: "bad",
          text: `Note must be non-empty and ${MAX_LINE_NOTE_BYTES} UTF-8 bytes or less.`,
        });
        return;
      }
      setLineNotes((current) => setLineNote(current, item.contentHash, normalized));
      setEditingNoteHash("");
      setNoteDraft("");
      setStatus({
        tone: "good",
        text: `Saved private note for ${shortHash(item.contentHash)}.`,
      });
      appendLog("good", `Saved note for ${shortHash(item.contentHash)}.`, "note");
    },
    [appendLog],
  );

  const clearLineNote = useCallback(
    (item: TimelineItem) => {
      setLineNotes((current) => setLineNote(current, item.contentHash, ""));
      setEditingNoteHash("");
      setNoteDraft("");
      setStatus({
        tone: "idle",
        text: `Cleared private note for ${shortHash(item.contentHash)}.`,
      });
      appendLog("idle", `Cleared note for ${shortHash(item.contentHash)}.`, "note");
    },
    [appendLog],
  );

  const toggleLineMark = useCallback(
    (item: TimelineItem) => {
      const currentMark = getLineMark(lineMarks, item.contentHash);
      const nextMark = nextLineMark(currentMark);
      setLineMarks((current) => setLineMark(current, item.contentHash, nextMark));
      setStatus({
        tone: nextMark ? "good" : "idle",
        text: nextMark
          ? `Marked ${shortHash(item.contentHash)} as ${nextMark} locally.`
          : `Cleared private mark for ${shortHash(item.contentHash)}.`,
      });
      appendLog(
        nextMark ? "good" : "idle",
        nextMark
          ? `Marked line ${shortHash(item.contentHash)} as ${nextMark}.`
          : `Cleared mark for ${shortHash(item.contentHash)}.`,
        "mark",
      );
    },
    [appendLog, lineMarks],
  );

  const composeDraftReference = useMemo(
    () =>
      answeringTo
        ? timelineItemToDraftReference(
            answeringTo,
            "reply",
            networkKey,
            contractAddress,
          )
        : echoingTo
          ? timelineItemToDraftReference(
              echoingTo,
              "echo",
              networkKey,
              contractAddress,
            )
          : undefined,
    [answeringTo, contractAddress, echoingTo, networkKey],
  );

  // Persist settings.
  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        networkKey,
        contractsByNetwork,
        rpcUrl,
        proofRpcUrl,
        fromBlock,
        nextScanBlock,
        draftText: postText,
        draftReference: composeDraftReference,
        draftQueue,
        imageUploadMode,
        imageUploadEndpoint,
        imageGatewayMode,
        scanScope,
        feedSort,
        trackedSigners,
        mutedSigners,
        mutedTerms,
        highlightedTerms,
        walletLabels,
        walletFlags,
        pinnedChannelsByScope,
        circlesByScope,
        readerLensesByScope,
        readerSources: serializeReaderSources(readerSources),
        profilePinsByScope,
        readLines,
        lineNotes,
        lineMarks,
        savedLines,
        savedLineCache,
        showMuted,
      }),
    );
  }, [
    networkKey,
    contractsByNetwork,
    contractAddress,
    composeDraftReference,
    rpcUrl,
    proofRpcUrl,
    fromBlock,
    nextScanBlock,
    postText,
    draftQueue,
    imageUploadMode,
    imageUploadEndpoint,
    imageGatewayMode,
    scanScope,
    feedSort,
    trackedSigners,
    mutedSigners,
    mutedTerms,
    highlightedTerms,
    walletLabels,
    walletFlags,
    pinnedChannelsByScope,
    circlesByScope,
    readerLensesByScope,
    readerSources,
    profilePinsByScope,
    readLines,
    lineNotes,
    lineMarks,
    savedLines,
    savedLineCache,
    showMuted,
  ]);

  useEffect(() => {
    return () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    };
  }, [imagePreviewUrl]);

  useEffect(() => {
    return () => {
      Object.values(verifiedImageUrlsRef.current).forEach((url) =>
        URL.revokeObjectURL(url),
      );
      verifiedImageUrlsRef.current = {};
    };
  }, []);

  useEffect(() => {
    const nextScope = `${networkKey}:${contractAddress.toLowerCase()}`;
    if (composeScopeRef.current === nextScope) return;
    composeScopeRef.current = nextScope;
    setAnsweringTo(null);
    setEchoingTo(null);
    setSelectedChannel("");
    setLastTx("");
  }, [contractAddress, networkKey]);

  useEffect(() => {
    setBundleImportPreview(null);
    setBundleImportError("");
  }, [contractAddress, networkKey]);

  const invalidateScans = useCallback(() => {
    scanRequestRef.current += 1;
    threadRequestRef.current += 1;
    setIsLoading(false);
    setThreadLoadingHash("");
  }, []);

  const resetScanBookmark = useCallback(() => {
    setNextScanBlock("");
    setOlderScanBlock("");
  }, []);

  const invalidateLineAudits = useCallback(() => {
    lineAuditGenerationRef.current += 1;
    setLineAudits({});
  }, []);

  const invalidateProofAudits = useCallback(() => {
    proofAuditGenerationRef.current += 1;
    setProofAudits({});
  }, []);

  const invalidateImageAudits = useCallback(() => {
    imageAuditGenerationRef.current += 1;
    setImageAudits({});
    Object.values(verifiedImageUrlsRef.current).forEach((url) =>
      URL.revokeObjectURL(url),
    );
    verifiedImageUrlsRef.current = {};
    setVerifiedImageUrls({});
  }, []);

  const resetFeedResults = useCallback(() => {
    feedVerifyRequestRef.current += 1;
    invalidateScans();
    invalidateLineAudits();
    invalidateProofAudits();
    invalidateImageAudits();
    setIsVerifyingFeed(false);
    setIsProofingFeed(false);
    resetScanBookmark();
    setTimeline([]);
    setThreadLoadingHash("");
    setThreadLoadedHashes({});
    setHasQueriedTimeline(false);
    setFeedProvenance(null);
    setFeedError("");
    setSigcards({});
    setSigcardErrors({});
    setProfileWatches({});
    setReaderControlsOpen(true);
  }, [
    invalidateImageAudits,
    invalidateLineAudits,
    invalidateProofAudits,
    invalidateScans,
    resetScanBookmark,
  ]);

  // Default RPC when switching networks.
  useEffect(() => {
    setRpcUrl((current) => current || NETWORKS[networkKey].rpcUrl);
  }, [networkKey]);

  // Boot log.
  useEffect(() => {
    if (bootLogged.current) return;
    bootLogged.current = true;
    appendLog("idle", "Session started.", "sys");
    appendLog("idle", `Using RPC ${shortRpc(rpcUrl)}`, "rpc");
    if (!contractAddress) {
      appendLog(
        "warn",
        "No contract address set — add one below to post or scan.",
        "setup",
      );
    }
  }, [appendLog, contractAddress, rpcUrl]);

  // Wallet event subscription.
  useEffect(() => {
    const handleAccounts = (accounts: unknown) => {
      if (Array.isArray(accounts) && typeof accounts[0] === "string") {
        invalidateScans();
        setAccount(accounts[0]);
        setTargetAddress((current) => current || accounts[0]);
        setNick("");
        setTwtUrl("");
        appendLog("good", `Connected as ${shorten(accounts[0])}`, "wallet");
      } else {
        invalidateScans();
        setAccount("");
        setTargetAddress("");
        setWalletChain(null);
        setNick("");
        setTwtUrl("");
        appendLog("warn", "Wallet disconnected.", "wallet");
      }
    };
    const handleChain = (chainId: unknown) => {
      if (typeof chainId === "string") {
        const cid = BigInt(chainId);
        setWalletChain(cid);
        appendLog("idle", `Wallet network changed (chain id ${cid}).`, "net");
      }
    };
    window.ethereum?.on?.("accountsChanged", handleAccounts);
    window.ethereum?.on?.("chainChanged", handleChain);
    return () => {
      window.ethereum?.removeListener?.("accountsChanged", handleAccounts);
      window.ethereum?.removeListener?.("chainChanged", handleChain);
    };
  }, [appendLog, invalidateScans]);

  // Telemetry from configured RPC.
  const telemetry = useChainTelemetry(
    rpcUrl || network.rpcUrl,
    network.chainId,
  );
  const { balance, loading: balanceLoading } = useBalance(
    rpcUrl || network.rpcUrl,
    network.chainId,
    account,
    balanceRefresh,
  );

  const contractReady = useMemo(
    () => isAddressLike(contractAddress),
    [contractAddress],
  );
  const lineAuditScope = useMemo(
    () =>
      [
        network.chainId.toString(),
        contractAddress.toLowerCase(),
        (rpcUrl || network.rpcUrl).trim(),
      ].join(":"),
    [contractAddress, network.chainId, network.rpcUrl, rpcUrl],
  );
  const proofAuditScope = useMemo(
    () =>
      [
        network.chainId.toString(),
        contractAddress.toLowerCase(),
        proofRpcUrl.trim(),
      ].join(":"),
    [contractAddress, network.chainId, proofRpcUrl],
  );
  const lineAuditScopeRef = useRef(lineAuditScope);
  const postBytes = useMemo(
    () => new TextEncoder().encode(postText.trim()).length,
    [postText],
  );
  const postOverByteLimit = postBytes > MAX_POST_BYTES;
  const imageAttachmentQueued = Boolean(
    imageFile || imageUpload || draftImagePointer,
  );
  const hasReferenceTarget = Boolean(answeringTo || echoingTo);
  const hasPostPayload = Boolean(
    postText.trim() || imageAttachmentQueued || hasReferenceTarget,
  );
  const activeDraft = useMemo(
    () => draftQueue.find((draft) => draft.id === activeDraftId),
    [activeDraftId, draftQueue],
  );
  const scopedDraftQueue = useMemo(
    () => filterDraftsForScope(draftQueue, networkKey, contractAddress),
    [contractAddress, draftQueue, networkKey],
  );
  const hasDraftableCompose = Boolean(
    postText.trim() ||
      imageFile ||
      imageUpload ||
      draftImagePointer ||
      composeDraftReference,
  );
  const expectedTreasuryConfigured = isAddressLike(EXPECTED_TREASURY);
  const canSelectImage = hasImagePass && !imagePassLoading;
  const postBlockedByImagePass = imageAttachmentQueued && !hasImagePass;
  const postBlockedByTreasury = !expectedTreasuryConfigured;
  const walletContractScope = [
    account.toLowerCase(),
    networkKey,
    network.chainId.toString(),
    contractAddress.toLowerCase(),
  ].join(":");
  const walletContractScopeRef = useRef(walletContractScope);
  walletContractScopeRef.current = walletContractScope;
  const publishUiScope = [
    walletContractScope,
    postText,
    answeringTo ? `reply:${answeringTo.contentHash.toLowerCase()}` : "",
    echoingTo ? `echo:${echoingTo.contentHash.toLowerCase()}` : "",
    imageFile
      ? `file:${imageSelectionGenerationRef.current}`
      : imageUpload
        ? `upload:${imageUpload.uri}:${imageUpload.hash.toLowerCase()}`
        : draftImagePointer
          ? `draft:${draftImagePointer.uri}:${draftImagePointer.hash.toLowerCase()}`
          : "",
    activeDraftId,
  ].join("\u0000");
  const publishUiScopeRef = useRef(publishUiScope);
  publishUiScopeRef.current = publishUiScope;
  const draftImageScope = [
    networkKey,
    contractAddress.toLowerCase(),
    activeDraftId,
  ].join(":");
  const draftImageScopeRef = useRef(draftImageScope);
  draftImageScopeRef.current = draftImageScope;
  const trackedSet = useMemo(
    () => new Set(trackedSigners.map((value) => value.toLowerCase())),
    [trackedSigners],
  );
  const bundleImportNewAuthors = useMemo(
    () =>
      bundleImportPreview
        ? bundleImportPreview.result.authors.filter(
            (author) => !trackedSet.has(author.toLowerCase()),
          )
        : [],
    [bundleImportPreview, trackedSet],
  );
  const mutedSet = useMemo(
    () => new Set(mutedSigners.map((value) => value.toLowerCase())),
    [mutedSigners],
  );
  const readSet = useMemo(() => new Set(readLines), [readLines]);
  const savedSet = useMemo(() => new Set(savedLines), [savedLines]);
  const savedCachedTimeline = useMemo(
    () =>
      Object.values(savedLineCache)
        .filter(
          (record) =>
            savedSet.has(record.contentHash.toLowerCase()) &&
            savedLineScopeMatches(record, networkKey, contractAddress),
        )
        .map(savedLineRecordToTimelineItem),
    [contractAddress, networkKey, savedLineCache, savedSet],
  );
  const savedCacheLatestAt = useMemo(
    () =>
      Object.values(savedLineCache)
        .filter(
          (record) =>
            savedSet.has(record.contentHash.toLowerCase()) &&
            savedLineScopeMatches(record, networkKey, contractAddress),
        )
        .reduce((latest, record) => Math.max(latest, record.savedAt), 0),
    [contractAddress, networkKey, savedLineCache, savedSet],
  );
  const chainAligned = walletChain === null || walletChain === network.chainId;
  const isPreviewTimeline =
    !hasQueriedTimeline &&
    timeline.length === 0 &&
    !(feedMode === "saved" && savedCachedTimeline.length > 0);
  const baseTimeline = isPreviewTimeline ? samplePosts : timeline;
  const shownTimeline = useMemo(() => {
    if (isPreviewTimeline || feedMode !== "saved") return baseTimeline;
    const liveHashes = new Set(
      baseTimeline.map((item) => item.contentHash.toLowerCase()),
    );
    return [
      ...baseTimeline,
      ...savedCachedTimeline.filter(
        (item) => !liveHashes.has(item.contentHash.toLowerCase()),
      ),
    ];
  }, [baseTimeline, feedMode, isPreviewTimeline, savedCachedTimeline]);
  const shownLineByHash = useMemo(() => {
    const byHash = new Map<string, TimelineItem>();
    shownTimeline.forEach((item) => {
      byHash.set(item.contentHash.toLowerCase(), item);
    });
    return byHash;
  }, [shownTimeline]);
  const liveTimeline = useMemo(
    () => (isPreviewTimeline ? [] : shownTimeline),
    [isPreviewTimeline, shownTimeline],
  );
  const channelScope = useMemo(
    () => channelScopeKey(networkKey, contractAddress),
    [contractAddress, networkKey],
  );
  const pinnedChannels = useMemo(
    () => (channelScope ? (pinnedChannelsByScope[channelScope] ?? []) : []),
    [channelScope, pinnedChannelsByScope],
  );
  const circleScope = useMemo(
    () => circleScopeKey(networkKey, contractAddress),
    [contractAddress, networkKey],
  );
  const circles = useMemo(
    () => (circleScope ? (circlesByScope[circleScope] ?? []) : []),
    [circleScope, circlesByScope],
  );
  const selectedCircleData = useMemo(
    () => circles.find((circle) => circle.id === selectedCircle),
    [circles, selectedCircle],
  );
  const trackedScanSigners = selectedCircleData
    ? selectedCircleData.addresses
    : trackedSigners;
  const selectedCircleMembers = useMemo(
    () => circleMemberSet(circles, selectedCircle),
    [circles, selectedCircle],
  );
  const bundleImportCircleNewAuthors = useMemo(
    () =>
      bundleImportPreview && selectedCircleData
        ? bundleImportPreview.result.authors.filter(
            (author) => !selectedCircleMembers.has(author.toLowerCase()),
          )
        : [],
    [bundleImportPreview, selectedCircleData, selectedCircleMembers],
  );
  const scanScopeLabel = useMemo(() => {
    if (scanScope === "all") return "everyone";
    if (scanScope === "tracked") {
      return selectedCircleData
        ? `${selectedCircleData.name} · ${trackedScanSigners.length}`
        : `tracked · ${trackedSigners.length}`;
    }
    return targetAddress && isAddressLike(targetAddress)
      ? shorten(targetAddress)
      : "one address";
  }, [
    scanScope,
    selectedCircleData,
    targetAddress,
    trackedScanSigners.length,
    trackedSigners.length,
  ]);
  const readerLensScope = useMemo(
    () => readerLensScopeKey(networkKey, contractAddress),
    [contractAddress, networkKey],
  );
  const readerLenses = useMemo(
    () => (readerLensScope ? (readerLensesByScope[readerLensScope] ?? []) : []),
    [readerLensScope, readerLensesByScope],
  );
  const feedNeedle = feedQuery.trim().toLowerCase();
  const activeChannel = selectedChannel;
  const activeCircle = selectedCircleData?.id ?? "";
  const mentionTargetAddress = account || (isAddressLike(targetAddress) ? targetAddress : "");
  const mentionTarget = useMemo(
    () => mentionTargetFromAddress(mentionTargetAddress, sigcards),
    [mentionTargetAddress, sigcards],
  );
  const hasActiveFeedFilter =
    Boolean(feedNeedle) ||
    feedMode !== "all" ||
    Boolean(activeChannel) ||
    Boolean(activeCircle);
  const itemMatchesMutedTerms = useCallback(
    (item: TimelineItem) => {
      if (!mutedTerms.length) return false;
      const referenced =
        item.refHash !== ZERO_HASH
          ? shownLineByHash.get(item.refHash.toLowerCase())
          : undefined;
      const haystack = [
        item.text,
        sigcards[item.author.toLowerCase()]?.nick ?? "",
        referenced?.text ?? "",
        referenced ? (sigcards[referenced.author.toLowerCase()]?.nick ?? "") : "",
      ]
        .join(" ")
        .toLowerCase();
      return mutedTerms.some((term) => haystack.includes(term));
    },
    [mutedTerms, shownLineByHash, sigcards],
  );
  const visibleTimeline = useMemo(
    () =>
      showMuted
        ? shownTimeline
        : shownTimeline.filter(
            (item) =>
              !mutedSet.has(item.author.toLowerCase()) &&
              !itemMatchesMutedTerms(item),
          ),
    [itemMatchesMutedTerms, mutedSet, showMuted, shownTimeline],
  );
  const lineByHash = useMemo(() => {
    const byHash = new Map<string, TimelineItem>();
    visibleTimeline.forEach((item) => {
      byHash.set(item.contentHash.toLowerCase(), item);
    });
    return byHash;
  }, [visibleTimeline]);
  const threadChildrenByHash = useMemo(
    () => getThreadChildrenByHash(visibleTimeline),
    [visibleTimeline],
  );
  const highlightedTermsForLine = useCallback(
    (item: TimelineItem) => {
      if (!highlightedTerms.length) return [];
      const referenced =
        item.refHash !== ZERO_HASH
          ? lineByHash.get(item.refHash.toLowerCase())
          : undefined;
      return matchingHighlightTerms(highlightedTerms, [
        item.text,
        sigcards[item.author.toLowerCase()]?.nick ?? "",
        referenced?.text ?? "",
        referenced
          ? (sigcards[referenced.author.toLowerCase()]?.nick ?? "")
          : "",
      ]);
    },
    [highlightedTerms, lineByHash, sigcards],
  );
  const lineAuditKey = useCallback(
    (item: TimelineItem) =>
      [
        lineAuditScope,
        item.author.toLowerCase(),
        item.index.toString(),
        item.contentHash.toLowerCase(),
        item.txHash.toLowerCase(),
      ].join(":"),
    [lineAuditScope],
  );
  const proofAuditKey = useCallback(
    (item: TimelineItem) =>
      [
        proofAuditScope,
        item.author.toLowerCase(),
        item.index.toString(),
        item.contentHash.toLowerCase(),
        item.txHash.toLowerCase(),
      ].join(":"),
    [proofAuditScope],
  );
  const imageAuditKey = useCallback(
    (item: TimelineItem) =>
      [imageGatewayMode, item.contentHash.toLowerCase()].join(":"),
    [imageGatewayMode],
  );
  const lineProofSnapshot = useCallback(
    (item: TimelineItem): SavedLineRecord["proof"] => {
      const proof = {
        sameRpc: auditToSavedProofStatus(lineAudits[lineAuditKey(item)]),
        independent: auditToSavedProofStatus(proofAudits[proofAuditKey(item)]),
        image: auditToSavedProofStatus(imageAudits[imageAuditKey(item)]),
      };
      return proof.sameRpc || proof.independent || proof.image ? proof : undefined;
    },
    [
      imageAuditKey,
      imageAudits,
      lineAuditKey,
      lineAudits,
      proofAuditKey,
      proofAudits,
    ],
  );
  const lineTrustSnapshot = useCallback(
    (item: TimelineItem) => {
      const key = item.contentHash.toLowerCase();
      const cachedRecord = savedLineCache[key];
      const cachedProof =
        cachedRecord &&
        savedLineScopeMatches(cachedRecord, networkKey, contractAddress)
          ? cachedRecord.proof
          : undefined;
      const liveSameRpc = lineAudits[lineAuditKey(item)];
      const liveIndependent = proofAudits[proofAuditKey(item)];
      const sameRpc = liveSameRpc ?? savedProofStatusToAudit(cachedProof?.sameRpc);
      const independent =
        liveIndependent ?? savedProofStatusToAudit(cachedProof?.independent);
      const image =
        imageAudits[imageAuditKey(item)] ??
        savedProofStatusToAudit(cachedProof?.image);
      return {
        sameRpc,
        independent,
        image,
        trusted: liveSameRpc?.tone === "good" || liveIndependent?.tone === "good",
      };
    },
    [
      contractAddress,
      imageAuditKey,
      imageAudits,
      lineAuditKey,
      lineAudits,
      networkKey,
      proofAuditKey,
      proofAudits,
      savedLineCache,
    ],
  );
  const filteredTimeline = useMemo(
    () =>
      visibleTimeline.filter((item) => {
        const referenced =
          item.refHash !== ZERO_HASH
            ? lineByHash.get(item.refHash.toLowerCase())
            : undefined;
        if (
          feedMode === "unread" &&
          readSet.has(item.contentHash.toLowerCase())
        ) {
          return false;
        }
        if (feedMode === "mentions" && !lineMentionsTarget(item, mentionTarget)) {
          return false;
        }
        if (
          feedMode === "media" &&
          (!item.imageUri || item.imageHash === ZERO_HASH)
        ) {
          return false;
        }
        if (feedMode === "refs" && item.refKind === REF_KIND_NONE) {
          return false;
        }
        if (
          feedMode === "saved" &&
          !savedSet.has(item.contentHash.toLowerCase())
        ) {
          return false;
        }
        if (feedMode === "marked" && !lineMarkForHash(item.contentHash)) {
          return false;
        }
        const highlightTerms = highlightedTermsForLine(item);
        if (feedMode === "highlighted" && highlightTerms.length === 0) {
          return false;
        }
        if (feedMode === "flagged" && !walletFlagFor(item.author)) {
          return false;
        }
        if (feedMode === "checked" && !lineTrustSnapshot(item).trusted) {
          return false;
        }
        if (
          feedMode === "needs-check" &&
          !lineNeedsCurrentCheck(item, lineTrustSnapshot(item))
        ) {
          return false;
        }
        if (activeChannel && !lineMatchesChannel(item, activeChannel)) {
          return false;
        }
        if (
          activeCircle &&
          !selectedCircleMembers.has(item.author.toLowerCase())
        ) {
          return false;
        }
        if (!feedNeedle) return true;
        return [
          item.text,
          highlightTerms.join(" "),
          lineMarkForHash(item.contentHash),
          lineNoteForHash(item.contentHash),
          walletLabelFor(item.author),
          walletFlagFor(item.author),
          sigcards[item.author.toLowerCase()]?.nick ?? "",
          referenced?.text ?? "",
          referenced ? lineMarkForHash(referenced.contentHash) : "",
          referenced ? lineNoteForHash(referenced.contentHash) : "",
          referenced ? walletLabelFor(referenced.author) : "",
          referenced ? walletFlagFor(referenced.author) : "",
          referenced
            ? (sigcards[referenced.author.toLowerCase()]?.nick ?? "")
            : "",
          item.author,
          item.contentHash,
          item.txHash,
          item.imageUri,
          item.imageHash,
          item.refHash,
          item.blockNumber.toString(),
          item.index.toString(),
        ]
          .join(" ")
          .toLowerCase()
          .includes(feedNeedle);
      }),
    [
      activeChannel,
      activeCircle,
      feedMode,
      feedNeedle,
      highlightedTermsForLine,
      lineTrustSnapshot,
      lineMarkForHash,
      lineNoteForHash,
      lineByHash,
      mentionTarget,
      readSet,
      savedSet,
      selectedCircleMembers,
      sigcards,
      visibleTimeline,
      walletLabelFor,
      walletFlagFor,
    ],
  );
  const sortedTimeline = useMemo(
    () => sortFeedRows(filteredTimeline, feedSort),
    [feedSort, filteredTimeline],
  );
  const feedRows = useMemo(
    () => (feedError ? [] : sortedTimeline),
    [feedError, sortedTimeline],
  );
  const displayedFeedProvenance = useMemo<FeedProvenance | null>(() => {
    if (isPreviewTimeline) {
      return {
        kind: "sample",
        scope: "sample feed",
        rpc: "local",
        loaded: feedRows.length,
        totalLoaded: shownTimeline.length,
        at: 0,
      };
    }
    if (
      feedMode === "saved" &&
      savedCachedTimeline.length > 0 &&
      timeline.length === 0
    ) {
      return {
        kind: "saved",
        scope: "browser cache",
        rpc: "local",
        loaded: feedRows.length,
        totalLoaded: shownTimeline.length,
        at: savedCacheLatestAt,
      };
    }
    return feedProvenance
      ? {
          ...feedProvenance,
          totalLoaded: shownTimeline.length,
        }
      : null;
  }, [
    feedMode,
    feedProvenance,
    feedRows.length,
    isPreviewTimeline,
    savedCacheLatestAt,
    savedCachedTimeline.length,
    shownTimeline.length,
    timeline.length,
  ]);
  const feedProvenanceSummary = useMemo(
    () =>
      displayedFeedProvenance
        ? summarizeFeedProvenance(displayedFeedProvenance)
        : null,
    [displayedFeedProvenance],
  );
  const feedStats = useMemo(
    () => getFeedStats(feedRows, savedSet, readSet),
    [feedRows, readSet, savedSet],
  );
  const channelStats = useMemo(
    () => summarizeChannels(visibleTimeline, readSet, pinnedChannels),
    [pinnedChannels, readSet, visibleTimeline],
  );
  const circleStats = useMemo(
    () => summarizeCircles(visibleTimeline, circles, readSet),
    [circles, readSet, visibleTimeline],
  );
  const mentionStats = useMemo(
    () => summarizeMentions(visibleTimeline, mentionTarget, readSet),
    [mentionTarget, readSet, visibleTimeline],
  );
  const markedVisibleLineCount = useMemo(
    () => visibleTimeline.filter((item) => lineMarkForHash(item.contentHash)).length,
    [lineMarkForHash, visibleTimeline],
  );
  const highlightedVisibleLineCount = useMemo(
    () =>
      visibleTimeline.filter(
        (item) => highlightedTermsForLine(item).length > 0,
      ).length,
    [highlightedTermsForLine, visibleTimeline],
  );
  const flaggedVisibleLineCount = useMemo(
    () => visibleTimeline.filter((item) => walletFlagFor(item.author)).length,
    [visibleTimeline, walletFlagFor],
  );
  const verifiableFeedRows = useMemo(
    () => feedRows.filter((item) => !isSampleItem(item)),
    [feedRows],
  );
  useEffect(() => {
    setSelectedCircle("");
  }, [circleScope]);
  useEffect(() => {
    if (selectedCircle && !selectedCircleData) setSelectedCircle("");
  }, [selectedCircle, selectedCircleData]);
  useEffect(() => {
    if (
      activeDraftId &&
      !scopedDraftQueue.some((draft) => draft.id === activeDraftId)
    ) {
      setActiveDraftId("");
    }
  }, [activeDraftId, scopedDraftQueue]);
  useEffect(() => {
    feedVerifyRequestRef.current += 1;
    setIsVerifyingFeed(false);
    proofAuditGenerationRef.current += 1;
    setIsProofingFeed(false);
  }, [
    feedMode,
    feedQuery,
    feedSort,
    lineMarks,
    lineNotes,
    highlightedTerms,
    walletFlags,
    mutedSigners,
    mutedTerms,
    selectedChannel,
    selectedCircle,
    readLines,
    savedLines,
    showMuted,
    walletLabels,
  ]);

  useEffect(() => {
    invalidateProofAudits();
  }, [invalidateProofAudits, proofAuditScope]);
  const requireTrustedLineAction = useCallback(
    (item: TimelineItem, action: string) => {
      if (lineTrustSnapshot(item).trusted) return true;
      setStatus({
        tone: "warn",
        text: `Run verify or 2-rpc proof before you ${action}.`,
      });
      appendLog(
        "warn",
        `Blocked ${action} for unchecked line ${shortHash(item.contentHash)}.`,
        "trust",
      );
      return false;
    },
    [appendLog, lineTrustSnapshot],
  );
  const trustedVisibleLineCount = useMemo(
    () =>
      verifiableFeedRows.filter((item) => lineTrustSnapshot(item).trusted).length,
    [lineTrustSnapshot, verifiableFeedRows],
  );
  const uncheckedVisibleLineCount = useMemo(
    () =>
      verifiableFeedRows.filter((item) =>
        lineNeedsCurrentCheck(item, lineTrustSnapshot(item)),
      ).length,
    [lineTrustSnapshot, verifiableFeedRows],
  );
  const hasUncheckedVisibleLines =
    verifiableFeedRows.length > trustedVisibleLineCount;
  const canScanNewer =
    contractReady && hasQueriedTimeline && Boolean(nextScanBlock);
  const canScanOlder =
    contractReady && hasQueriedTimeline && Boolean(olderScanBlock);

  useEffect(() => {
    if (savedLines.length === 0 || shownTimeline.length === 0) return;
    setSavedLineCache((current) => {
      let changed = false;
      const next = { ...current };
      shownTimeline.forEach((item) => {
        const key = item.contentHash.toLowerCase();
        const cached = next[key];
        if (
          !savedSet.has(key) ||
          !cached ||
          !savedLineScopeMatches(cached, networkKey, contractAddress)
        ) {
          return;
        }
        const proof = lineProofSnapshot(item);
        if (JSON.stringify(cached.proof ?? {}) === JSON.stringify(proof ?? {})) {
          return;
        }
        next[key] = { ...cached, proof };
        changed = true;
      });
      return changed ? next : current;
    });
  }, [
    contractAddress,
    lineProofSnapshot,
    networkKey,
    savedLines.length,
    savedSet,
    shownTimeline,
  ]);

  useEffect(() => {
    lineAuditScopeRef.current = lineAuditScope;
  }, [lineAuditScope]);

  useEffect(() => {
    invalidateScans();
  }, [
    fromBlock,
    invalidateScans,
    lineAuditScope,
    scanScope,
    targetAddress,
    trackedScanSigners,
  ]);

  const knownSignerAddresses = useMemo(() => {
    const seen = new Map<string, string>();
    const add = (value: string) => {
      if (!isAddressLike(value)) return;
      const normalized = getAddress(value);
      seen.set(normalized.toLowerCase(), normalized);
    };
    if (account) add(account);
    trackedSigners.forEach(add);
    circles.forEach((circle) => circle.addresses.forEach(add));
    Object.keys(walletLabels).forEach(add);
    Object.keys(walletFlags).forEach(add);
    Object.keys(profilePins).forEach(add);
    liveTimeline.forEach((item) => add(item.author));
    return [...seen.values()].sort();
  }, [
    account,
    circles,
    liveTimeline,
    profilePins,
    trackedSigners,
    walletFlags,
    walletLabels,
  ]);
  const sigcardLookupAddresses = useMemo(() => {
    const seen = new Map<string, string>();
    const add = (value: string) => {
      if (!isAddressLike(value)) return;
      const normalized = getAddress(value);
      seen.set(normalized.toLowerCase(), normalized);
    };
    if (account) add(account);
    liveTimeline.forEach((item) => add(item.author));
    return [...seen.values()].sort();
  }, [account, liveTimeline]);
  const sigcardLookupSet = useMemo(
    () => new Set(sigcardLookupAddresses.map((address) => address.toLowerCase())),
    [sigcardLookupAddresses],
  );
  const localSignerStats = useMemo(() => {
    const stats = new Map<string, { latestAt: number; visibleCount: number }>();
    liveTimeline.forEach((item) => {
      const key = item.author.toLowerCase();
      const current = stats.get(key);
      stats.set(key, {
        latestAt: Math.max(current?.latestAt ?? 0, item.createdAt),
        visibleCount: (current?.visibleCount ?? 0) + 1,
      });
    });
    return stats;
  }, [liveTimeline]);
  const sigcardViews = useMemo<SigcardView[]>(() => {
    return knownSignerAddresses.map((address) => {
      const key = address.toLowerCase();
      const local = localSignerStats.get(key);
      const remote = sigcards[key];
      const nick = remote?.nick ?? "";
      const twtUrl = remote?.twtUrl ?? "";
      const updatedAt = remote?.updatedAt ?? 0;
      const profilePin = profilePins[key];
      const error = sigcardErrors[key];
      const profileWasLookedUp = sigcardLookupSet.has(key);
      return {
        address,
        nick,
        localLabel: walletLabelFor(address),
        localFlag: walletFlagFor(address),
        profilePin,
        profilePinStatus: getProfilePinStatus(profilePin, {
          address,
          nick,
          twtUrl,
          updatedAt,
          available: profileWasLookedUp && !error,
        }),
        twtUrl,
        updatedAt,
        postCount: remote?.postCount ?? BigInt(local?.visibleCount ?? 0),
        latestAt: local?.latestAt ?? 0,
        visibleCount: local?.visibleCount ?? 0,
        error,
        profileWatch: profileWatches[key],
      };
    });
  }, [
    knownSignerAddresses,
    localSignerStats,
    profilePins,
    profileWatches,
    sigcardLookupSet,
    sigcardErrors,
    sigcards,
    walletFlagFor,
    walletLabelFor,
  ]);
  // The wallet is actively signing/waiting on a tx (not just scanning).
  const walletBusy = isPosting || isSealingId || isBuyingImagePass;

  useEffect(() => {
    let cancelled = false;
    const loadSigcards = async () => {
      if (!contractReady) {
        setSigcards({});
        setSigcardErrors({});
        setProfileWatches({});
        setIsLoadingSigcards(false);
        return;
      }
      if (sigcardLookupAddresses.length === 0) {
        setSigcards({});
        setSigcardErrors({});
        setProfileWatches({});
        setIsLoadingSigcards(false);
        return;
      }
      setIsLoadingSigcards(true);
      try {
        const provider = new JsonRpcProvider(
          rpcUrl || network.rpcUrl,
          Number(network.chainId),
        );
        await assertSiglineContract(provider, contractAddress, network);
        const contract = new Contract(contractAddress, ABI, provider);
        const results = await Promise.all(
          sigcardLookupAddresses.map(async (address) => {
            const key = address.toLowerCase();
            try {
              const card = await readSigcard(provider, contractAddress, address);
              return { key, card, error: "" };
            } catch {
              return {
                key,
                card: {
                  address,
                  nick: "",
                  twtUrl: "",
                  updatedAt: 0,
                  postCount: 0n,
                },
                error: "profile unavailable",
              };
            }
          }),
        );
        let nextProfileWatches: Record<string, ProfileWatch> = {};
        try {
          const watched = new Set(
            sigcardLookupAddresses.map((address) => address.toLowerCase()),
          );
          const events = await queryProfileEvents(
            provider,
            contract,
            fromBlock,
          );
          nextProfileWatches = summarizeProfileWatches(
            events.filter((event) => watched.has(event.account.toLowerCase())),
          );
        } catch {
          nextProfileWatches = {};
        }
        if (!cancelled) {
          setSigcards(
            Object.fromEntries(results.map(({ key, card }) => [key, card])),
          );
          setSigcardErrors(
            Object.fromEntries(
              results
                .filter(({ error }) => error)
                .map(({ key, error }) => [key, error]),
            ),
          );
          setProfileWatches(nextProfileWatches);
        }
      } catch {
        if (!cancelled) {
          setSigcards({});
          setSigcardErrors(
            Object.fromEntries(
              sigcardLookupAddresses.map((address) => [
                address.toLowerCase(),
                "profile unavailable",
              ]),
            ),
          );
          setProfileWatches({});
        }
      } finally {
        if (!cancelled) setIsLoadingSigcards(false);
      }
    };
    void loadSigcards();
    return () => {
      cancelled = true;
    };
  }, [
    contractAddress,
    contractReady,
    fromBlock,
    network,
    network.chainId,
    network.rpcUrl,
    rpcUrl,
    sigcardRefresh,
    sigcardLookupAddresses,
  ]);

  useEffect(() => {
    let cancelled = false;
    const loadImagePass = async () => {
      if (!contractReady || !account) {
        setHasImagePass(false);
        setImagePassLoading(false);
        return;
      }
      setHasImagePass(false);
      setImagePassLoading(true);
      try {
        const provider = new JsonRpcProvider(
          rpcUrl || network.rpcUrl,
          Number(network.chainId),
        );
        await assertSiglineContract(provider, contractAddress, network);
        const enabled = await readImagePass(provider, contractAddress, account);
        if (!cancelled) setHasImagePass(enabled);
      } catch {
        if (!cancelled) setHasImagePass(false);
      } finally {
        if (!cancelled) setImagePassLoading(false);
      }
    };
    void loadImagePass();
    return () => {
      cancelled = true;
    };
  }, [
    account,
    contractAddress,
    contractReady,
    imagePassRefresh,
    network,
    network.chainId,
    network.rpcUrl,
    rpcUrl,
  ]);

  /* --------------------------------- actions -------------------------------- */

  const connectWallet = useCallback(async () => {
    if (!window.ethereum) {
      const msg =
        "No browser wallet detected. Install MetaMask or a compatible wallet.";
      setStatus({ tone: "bad", text: msg });
      appendLog("bad", msg, "wallet");
      return;
    }
    try {
      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      const currentNetwork = await provider.getNetwork();
      invalidateScans();
      setAccount(address);
      setTargetAddress((current) => current || address);
      setWalletChain(currentNetwork.chainId);
      setNick("");
      setTwtUrl("");
      setStatus({ tone: "good", text: "Wallet connected." });
      appendLog("good", `Connected ${shorten(address)}`, "wallet");
    } catch (error) {
      const msg = getDisplayErrorMessage(error);
      setStatus({ tone: "bad", text: msg });
      appendLog("bad", msg, "wallet");
    }
  }, [appendLog, invalidateScans]);

  const switchNetwork = useCallback(async () => {
    if (!window.ethereum) {
      setStatus({ tone: "bad", text: "No browser wallet detected." });
      return;
    }
    try {
      await switchOrAddNetwork(network);
      setWalletChain(network.chainId);
      setStatus({ tone: "good", text: `Switched to ${network.label}.` });
      appendLog("good", `Switched network to ${network.short}.`, "net");
    } catch (error) {
      const msg = getDisplayErrorMessage(error);
      setStatus({ tone: "bad", text: msg });
      appendLog("bad", msg, "net");
    }
  }, [appendLog, network]);

  const buyImagePass = useCallback(async () => {
    if (!contractReady) {
      setStatus({
        tone: "warn",
        text: "Set a contract address before buying an image pass.",
      });
      return;
    }
    if (!expectedTreasuryConfigured) {
      setStatus({
        tone: "warn",
        text: "Configure the expected treasury before buying an image pass.",
      });
      return;
    }
    if (!isAddressLike(account)) {
      setStatus({
        tone: "warn",
        text: "Connect a wallet before buying an image pass.",
      });
      return;
    }
    const purchaseAccount = account;
    const purchaseScope = walletContractScope;
    const purchaseRequest = imagePassPurchaseRef.current + 1;
    imagePassPurchaseRef.current = purchaseRequest;
    const purchaseStillCurrent = () =>
      imagePassPurchaseRef.current === purchaseRequest &&
      walletContractScopeRef.current === purchaseScope;
    try {
      setIsBuyingImagePass(true);
      appendLog("idle", "Preparing image pass purchase.", "image");
      await ensureWalletOnNetwork(network);
      if (!purchaseStillCurrent()) return;
      const contract = await writableContract(contractAddress, network, {
        expectedSigner: purchaseAccount,
      });
      const fee = await contract.IMAGE_PASS_FEE();
      if (!purchaseStillCurrent()) return;
      const tx = await contract.buyImagePass({ value: fee });
      if (purchaseStillCurrent()) {
        setStatus({
          tone: "idle",
          text: `Submitted image pass for ${formatEther(fee)} ${network.currency}.`,
        });
      }
      appendLog("idle", `Submitted tx ${shorten(tx.hash)}`, "image");
      const receipt = await tx.wait();
      appendLog(
        "good",
        `Image pass active in block ${receipt.blockNumber} (${shorten(receipt.hash)}).`,
        "image",
      );
      if (purchaseStillCurrent()) {
        setLastTx(receipt.hash);
        setImagePassRefresh((n) => n + 1);
        setBalanceRefresh((n) => n + 1);
        setStatus({ tone: "good", text: "Image pass active." });
      }
    } catch (error) {
      const msg = getDisplayErrorMessage(error);
      if (purchaseStillCurrent()) setStatus({ tone: "bad", text: msg });
      appendLog("bad", msg, "image");
    } finally {
      if (imagePassPurchaseRef.current === purchaseRequest) {
        setIsBuyingImagePass(false);
      }
    }
  }, [
    account,
    appendLog,
    contractAddress,
    contractReady,
    expectedTreasuryConfigured,
    network,
    walletContractScope,
  ]);

  const trackSigner = useCallback(
    (value: string) => {
      if (!isAddressLike(value)) {
        setStatus({ tone: "warn", text: "That wallet address is invalid." });
        return;
      }
      const normalized = getAddress(value);
      resetFeedResults();
      setTrackedSigners((current) => {
        if (current.some((item) => item.toLowerCase() === normalized.toLowerCase())) {
          return current;
        }
        return [...current, normalized].sort();
      });
      setStatus({ tone: "good", text: `Tracking ${shorten(normalized)}.` });
      appendLog("good", `Tracking wallet ${shorten(normalized)}.`, "track");
    },
    [appendLog, resetFeedResults],
  );

  const forgetSigner = useCallback(
    (value: string) => {
      const normalized = getAddress(value);
      resetFeedResults();
      setTrackedSigners((current) =>
        current.filter((item) => item.toLowerCase() !== normalized.toLowerCase()),
      );
      if (circleScope) {
        setCirclesByScope((current) => ({
          ...current,
          [circleScope]: removeAddressFromCircles(
            current[circleScope] ?? [],
            normalized,
          ),
        }));
      }
      setStatus({ tone: "idle", text: `Stopped tracking ${shorten(normalized)}.` });
      appendLog("idle", `Forgot wallet ${shorten(normalized)}.`, "track");
    },
    [appendLog, circleScope, resetFeedResults],
  );

  const muteSigner = useCallback(
    (value: string) => {
      if (!isAddressLike(value)) {
        setStatus({ tone: "warn", text: "That wallet address is invalid." });
        return;
      }
      const normalized = getAddress(value);
      setMutedSigners((current) => {
        if (current.some((item) => item.toLowerCase() === normalized.toLowerCase())) {
          return current;
        }
        return [...current, normalized].sort();
      });
      setStatus({ tone: "idle", text: `Muted ${shorten(normalized)} locally.` });
      appendLog("idle", `Muted wallet ${shorten(normalized)} locally.`, "safety");
    },
    [appendLog],
  );

  const unmuteSigner = useCallback(
    (value: string) => {
      const normalized = getAddress(value);
      setMutedSigners((current) =>
        current.filter((item) => item.toLowerCase() !== normalized.toLowerCase()),
      );
      setStatus({ tone: "good", text: `Unmuted ${shorten(normalized)}.` });
      appendLog("good", `Unmuted wallet ${shorten(normalized)}.`, "safety");
    },
    [appendLog],
  );

  const addMutedTerm = useCallback(
    (value: string) => {
      const normalized = normalizeMutedTerm(value);
      if (!normalized) {
        setStatus({
          tone: "warn",
          text: `Mute text must be 1-${MAX_MUTED_TERM_BYTES} bytes.`,
        });
        return;
      }
      if (mutedTerms.includes(normalized) || mutedTerms.length >= MAX_MUTED_TERMS) {
        setStatus({
          tone: "warn",
          text: `Mute text is already listed, or the ${MAX_MUTED_TERMS}-term limit is full.`,
        });
        return;
      }
      setMutedTerms([...mutedTerms, normalized].sort());
      setMuteTermInput("");
      setStatus({ tone: "idle", text: `Muted text "${normalized}" locally.` });
      appendLog("idle", `Muted text "${normalized}" locally.`, "safety");
    },
    [appendLog, mutedTerms],
  );

  const removeMutedTerm = useCallback(
    (value: string) => {
      setMutedTerms((current) => current.filter((item) => item !== value));
      setStatus({ tone: "good", text: `Removed text mute "${value}".` });
      appendLog("good", `Removed text mute "${value}".`, "safety");
    },
    [appendLog],
  );

  const addHighlightedTerm = useCallback(
    (value: string) => {
      const normalized = normalizeHighlightTerm(value);
      if (!normalized) {
        setStatus({
          tone: "warn",
          text: `Highlight text must be 1-${MAX_HIGHLIGHT_TERM_BYTES} bytes.`,
        });
        return;
      }
      if (
        highlightedTerms.includes(normalized) ||
        highlightedTerms.length >= MAX_HIGHLIGHT_TERMS
      ) {
        setStatus({
          tone: "warn",
          text: `Highlight text is already listed, or the ${MAX_HIGHLIGHT_TERMS}-term limit is full.`,
        });
        return;
      }
      setHighlightedTerms([...highlightedTerms, normalized].sort());
      setHighlightTermInput("");
      setStatus({ tone: "good", text: `Highlighting text "${normalized}" locally.` });
      appendLog("good", `Highlighted text "${normalized}" locally.`, "safety");
    },
    [appendLog, highlightedTerms],
  );

  const removeHighlightedTerm = useCallback(
    (value: string) => {
      setHighlightedTerms((current) => current.filter((item) => item !== value));
      setStatus({ tone: "idle", text: `Removed highlight "${value}".` });
      appendLog("idle", `Removed highlight "${value}".`, "safety");
    },
    [appendLog],
  );

  const saveReaderLens = useCallback(
    (value: string) => {
      if (!readerLensScope) {
        setStatus({
          tone: "warn",
          text: "Set a contract address before saving a reader lens.",
        });
        return;
      }
      const name = normalizeReaderLensName(value);
      const id = readerLensIdFromName(name);
      if (!name || !id) {
        setStatus({
          tone: "warn",
          text: `Lens names must be 1-${MAX_READER_LENS_NAME_BYTES} bytes.`,
        });
        return;
      }
      const lens: ReaderLens = {
        id,
        name,
        query: feedQuery,
        mode: feedMode,
        channel: selectedChannel,
        circle: selectedCircle,
        sort: feedSort,
        showMuted,
        updatedAt: Date.now(),
      };
      setReaderLensesByScope((current) => ({
        ...current,
        [readerLensScope]: upsertReaderLens(
          current[readerLensScope] ?? [],
          lens,
        ),
      }));
      setReaderLensNameInput("");
      setStatus({ tone: "good", text: `Saved local lens "${name}".` });
      appendLog("good", `Saved local reader lens "${name}".`, "feed");
    },
    [
      appendLog,
      feedMode,
      feedQuery,
      feedSort,
      readerLensScope,
      selectedChannel,
      selectedCircle,
      showMuted,
    ],
  );

  const applyReaderLens = useCallback(
    (lens: ReaderLens) => {
      setFeedQuery(lens.query);
      setFeedMode(lens.mode);
      setSelectedChannel(lens.channel);
      setSelectedCircle(lens.circle);
      setFeedSort(lens.sort);
      setShowMuted(lens.showMuted);
      setReaderControlsOpen(true);
      setStatus({ tone: "idle", text: `Applied local lens "${lens.name}".` });
      appendLog("idle", `Applied local reader lens "${lens.name}".`, "feed");
    },
    [appendLog],
  );

  const removeReaderLens = useCallback(
    (lens: ReaderLens) => {
      if (!readerLensScope) return;
      setReaderLensesByScope((current) => {
        const next = deleteReaderLens(current[readerLensScope] ?? [], lens.id);
        return {
          ...current,
          [readerLensScope]: next,
        };
      });
      setStatus({ tone: "idle", text: `Removed local lens "${lens.name}".` });
      appendLog("idle", `Removed local reader lens "${lens.name}".`, "feed");
    },
    [appendLog, readerLensScope],
  );

  const saveReaderSource = useCallback(
    (value: string) => {
      if (!contractReady) {
        setStatus({
          tone: "warn",
          text: "Set a contract address before saving a reader source.",
        });
        return;
      }
      const name = normalizeReaderSourceName(value);
      if (!name) {
        setStatus({
          tone: "warn",
          text: `Source names must be 1-${MAX_READER_SOURCE_NAME_BYTES} bytes.`,
        });
        return;
      }
      if (scanScope === "address" && !isAddressLike(targetAddress)) {
        setStatus({
          tone: "warn",
          text: "Enter a valid wallet address before saving an address source.",
        });
        return;
      }
      const source = makeReaderSource({
        name,
        networkKey,
        contractAddress,
        fromBlock,
        scanScope,
        author: targetAddress,
        channel: selectedChannel,
        mode: feedMode,
        sort: feedSort,
        updatedAt: Date.now(),
      });
      if (!source) {
        setStatus({
          tone: "warn",
          text: "Current reader state cannot be saved as a public source.",
        });
        return;
      }
      const omittedPrivateState =
        Boolean(feedQuery.trim()) ||
        scanScope === "tracked" ||
        Boolean(selectedCircle) ||
        showMuted ||
        !["all", "media", "refs"].includes(feedMode);
      setReaderSources((current) => upsertReaderSource(current, source));
      setReaderSourceNameInput("");
      setStatus({
        tone: "good",
        text: omittedPrivateState
          ? `Saved public source "${source.name}". Private filters were omitted.`
          : `Saved public source "${source.name}".`,
      });
      appendLog(
        "good",
        omittedPrivateState
          ? `Saved public reader source "${source.name}" with private filters omitted.`
          : `Saved public reader source "${source.name}".`,
        "feed",
      );
    },
    [
      appendLog,
      contractAddress,
      contractReady,
      feedMode,
      feedQuery,
      feedSort,
      fromBlock,
      networkKey,
      scanScope,
      selectedChannel,
      selectedCircle,
      showMuted,
      targetAddress,
    ],
  );

  const applyReaderSource = useCallback(
    (source: ReaderSource) => {
      resetFeedResults();
      setNetworkKey(source.networkKey);
      setContractsByNetwork((current) => ({
        ...current,
        [source.networkKey]: source.contractAddress,
      }));
      setFromBlock(source.fromBlock);
      setRpcUrl(NETWORKS[source.networkKey].rpcUrl);
      setProofRpcUrl("");
      setScanScope(source.scanScope);
      setTargetAddress(source.author);
      setSelectedChannel(source.channel);
      setFeedMode(source.mode);
      setFeedSort(source.sort);
      setFeedQuery("");
      setSelectedCircle("");
      setShowMuted(false);
      setReaderControlsOpen(true);
      setStatus({
        tone: "idle",
        text: `Applied public source "${source.name}". Press scan to load it.`,
      });
      appendLog(
        "idle",
        `Applied public reader source "${source.name}".`,
        "feed",
      );
    },
    [appendLog, resetFeedResults],
  );

  const removeReaderSource = useCallback(
    (source: ReaderSource) => {
      setReaderSources((current) => deleteReaderSource(current, source.id));
      setStatus({ tone: "idle", text: `Removed public source "${source.name}".` });
      appendLog("idle", `Removed public reader source "${source.name}".`, "feed");
    },
    [appendLog],
  );

  const createEncryptedSettingsBackup = useCallback(async () => {
    if (!vaultPassphrase) {
      throw new Error("Enter a backup passphrase first.");
    }
    if (vaultPassphrase !== vaultPassphraseConfirm) {
      throw new Error("Backup passphrase confirmation does not match.");
    }
    const settingsJson = localStorage.getItem(STORAGE_KEY) || "{}";
    return exportEncryptedVault(settingsJson, vaultPassphrase);
  }, [vaultPassphrase, vaultPassphraseConfirm]);

  const copyLocalVault = useCallback(async () => {
    try {
      setIsVaultBusy(true);
      const vault = await createEncryptedSettingsBackup();
      await navigator.clipboard.writeText(vault);
      setVaultPassphrase("");
      setVaultPassphraseConfirm("");
      setStatus({
        tone: "good",
        text: "Encrypted settings backup copied to clipboard.",
      });
      appendLog("good", "Copied encrypted settings backup.", "vault");
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Encrypted backup export failed.";
      setStatus({ tone: "bad", text: msg });
      appendLog("bad", msg, "vault");
    } finally {
      setIsVaultBusy(false);
    }
  }, [appendLog, createEncryptedSettingsBackup]);

  const downloadLocalVault = useCallback(async () => {
    try {
      setIsVaultBusy(true);
      const vault = await createEncryptedSettingsBackup();
      const blobUrl = URL.createObjectURL(
        new Blob([vault], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `sigline-settings-${new Date()
        .toISOString()
        .slice(0, 10)}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 500);
      setVaultPassphrase("");
      setVaultPassphraseConfirm("");
      setStatus({ tone: "good", text: "Encrypted settings backup downloaded." });
      appendLog("good", "Downloaded encrypted settings backup.", "vault");
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Encrypted backup export failed.";
      setStatus({ tone: "bad", text: msg });
      appendLog("bad", msg, "vault");
    } finally {
      setIsVaultBusy(false);
    }
  }, [appendLog, createEncryptedSettingsBackup]);

  const importLocalVault = useCallback(async () => {
    if (!vaultPassphrase) {
      setStatus({ tone: "warn", text: "Enter the backup passphrase first." });
      return;
    }
    if (!vaultImportText.trim()) {
      setStatus({ tone: "warn", text: "Paste an encrypted backup first." });
      return;
    }
    try {
      setIsVaultBusy(true);
      const settingsJson = await importEncryptedVault(
        vaultImportText,
        vaultPassphrase,
      );
      const summary = formatSettingsImportSummary(
        localStorage.getItem(STORAGE_KEY) || "{}",
        settingsJson,
      );
      if (!window.confirm(summary)) return;
      localStorage.setItem(STORAGE_KEY, settingsJson);
      setVaultPassphrase("");
      setVaultPassphraseConfirm("");
      setVaultImportText("");
      setStatus({
        tone: "good",
        text: "Encrypted settings backup imported. Reloading local settings…",
      });
      appendLog("good", "Imported encrypted settings backup.", "vault");
      window.setTimeout(() => window.location.reload(), 350);
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Encrypted backup import failed.";
      setStatus({ tone: "bad", text: msg });
      appendLog("bad", msg, "vault");
    } finally {
      setIsVaultBusy(false);
    }
  }, [appendLog, vaultImportText, vaultPassphrase]);

  const toggleSavedLine = useCallback(
    (item: TimelineItem) => {
      if (isSampleItem(item)) {
        setStatus({ tone: "warn", text: "Sample lines cannot be saved." });
        return;
      }
      const key = item.contentHash.toLowerCase();
      const isSaved = savedLines.includes(key);
      if (!isSaved && !requireTrustedLineAction(item, "save it")) return;
      setSavedLines((current) =>
        isSaved
          ? current.filter((value) => value !== key)
          : [...current, key].sort(),
      );
      setSavedLineCache((current) => {
        if (isSaved) {
          const next = { ...current };
          delete next[key];
          return next;
        }
        return {
          ...current,
          [key]: timelineItemToSavedLineRecord({
            item,
            networkKey,
            contractAddress,
            publicUrl: buildLinePermalink(
              window.location.href,
              networkKey,
              contractAddress,
              item,
            ),
            proof: lineProofSnapshot(item),
          }),
        };
      });
      setStatus({
        tone: isSaved ? "idle" : "good",
        text: isSaved
          ? `Removed ${shortHash(item.contentHash)} from saved.`
          : `Saved ${shortHash(item.contentHash)} locally for offline saved view.`,
      });
      appendLog(
        isSaved ? "idle" : "good",
        `${isSaved ? "Removed" : "Saved"} line ${shortHash(item.contentHash)}.`,
        "line",
      );
    },
    [
      appendLog,
      contractAddress,
      lineProofSnapshot,
      networkKey,
      requireTrustedLineAction,
      savedLines,
    ],
  );

  const toggleReadLine = useCallback(
    (item: TimelineItem) => {
      if (isSampleItem(item)) {
        setStatus({ tone: "warn", text: "Sample lines cannot be marked read." });
        return;
      }
      const key = item.contentHash.toLowerCase();
      const wasRead = readLines.includes(key);
      setReadLines((current) =>
        wasRead
          ? current.filter((value) => value !== key)
          : mergeReadLineHashes(current, [key]),
      );
      setStatus({
        tone: wasRead ? "idle" : "good",
        text: wasRead
          ? `Marked ${shortHash(item.contentHash)} unread locally.`
          : `Marked ${shortHash(item.contentHash)} read locally.`,
      });
      appendLog(
        wasRead ? "idle" : "good",
        `Marked line ${shortHash(item.contentHash)} ${wasRead ? "unread" : "read"} locally.`,
        "feed",
      );
    },
    [appendLog, readLines],
  );

  const markVisibleRead = useCallback(() => {
    const hashes = feedRows
      .filter((item) => !isSampleItem(item))
      .map((item) => item.contentHash.toLowerCase());
    if (!hashes.length) {
      setStatus({ tone: "warn", text: "No real visible lines to mark read." });
      return;
    }
    setReadLines((current) => mergeReadLineHashes(current, hashes));
    setStatus({
      tone: "good",
      text: `Marked ${hashes.length} visible line${hashes.length === 1 ? "" : "s"} read locally.`,
    });
    appendLog(
      "good",
      `Marked ${hashes.length} visible line${hashes.length === 1 ? "" : "s"} read locally.`,
      "feed",
    );
  }, [appendLog, feedRows]);

  const togglePinnedChannel = useCallback(
    (channel: ChannelId) => {
      if (!channelScope) {
        setStatus({
          tone: "warn",
          text: "Set a contract address before pinning local channels.",
        });
        return;
      }
      const isPinned = pinnedChannels.includes(channel);
      setPinnedChannelsByScope((current) => {
        const next = { ...current };
        const currentPins = next[channelScope] ?? [];
        const pins = isPinned
          ? currentPins.filter((item) => item !== channel)
          : mergePinnedChannels(currentPins, [channel]);
        if (pins.length) {
          next[channelScope] = pins;
        } else {
          delete next[channelScope];
        }
        return normalizePinnedChannelsByScope(next);
      });
      setStatus({
        tone: isPinned ? "idle" : "good",
        text: `${isPinned ? "Unpinned" : "Pinned"} ${channelLabel(channel)} locally.`,
      });
      appendLog(
        isPinned ? "idle" : "good",
        `${isPinned ? "Unpinned" : "Pinned"} local channel ${channelLabel(channel)}.`,
        "feed",
      );
    },
    [appendLog, channelScope, pinnedChannels],
  );

  const createCircle = useCallback(() => {
    if (!circleScope) {
      setStatus({
        tone: "warn",
        text: "Set a contract address before creating local circles.",
      });
      return;
    }
    const name = normalizeCircleName(circleNameInput);
    const circleId = circleIdFromName(name);
    if (!name || !circleId) {
      setStatus({
        tone: "warn",
        text: "Circle names can use letters, numbers, spaces, dots, dashes, or underscores.",
      });
      return;
    }
    setCirclesByScope((current) => ({
      ...current,
      [circleScope]: upsertCircle(current[circleScope] ?? [], name),
    }));
    setSelectedCircle(circleId);
    setCircleNameInput("");
    setStatus({ tone: "good", text: `Created local circle ${name}.` });
    appendLog("good", `Created local circle ${name}.`, "circle");
  }, [appendLog, circleNameInput, circleScope]);

  const removeSelectedCircle = useCallback(() => {
    if (!circleScope || !selectedCircleData) return;
    const name = selectedCircleData.name;
    setCirclesByScope((current) => {
      const next = deleteCircle(current[circleScope] ?? [], selectedCircleData.id);
      const scoped = { ...current };
      if (next.length) {
        scoped[circleScope] = next;
      } else {
        delete scoped[circleScope];
      }
      return scoped;
    });
    setSelectedCircle("");
    setStatus({ tone: "idle", text: `Deleted local circle ${name}.` });
    appendLog("idle", `Deleted local circle ${name}.`, "circle");
  }, [appendLog, circleScope, selectedCircleData]);

  const toggleSelectedCircleMember = useCallback(
    (address: string) => {
      if (!circleScope || !selectedCircleData) {
        setStatus({ tone: "warn", text: "Select a local circle first." });
        return;
      }
      if (!isAddressLike(address)) {
        setStatus({ tone: "warn", text: "That wallet address is invalid." });
        return;
      }
      const normalized = getAddress(address);
      const wasMember = selectedCircleMembers.has(normalized.toLowerCase());
      setCirclesByScope((current) => ({
        ...current,
        [circleScope]: toggleCircleMember(
          current[circleScope] ?? [],
          selectedCircleData.id,
          normalized,
        ),
      }));
      if (!wasMember) {
        setTrackedSigners((current) => {
          if (
            current.some(
              (item) => item.toLowerCase() === normalized.toLowerCase(),
            )
          ) {
            return current;
          }
          return [...current, normalized].sort();
        });
      }
      setStatus({
        tone: wasMember ? "idle" : "good",
        text: `${wasMember ? "Removed" : "Added"} ${shorten(normalized)} ${wasMember ? "from" : "to"} ${selectedCircleData.name}.`,
      });
      appendLog(
        wasMember ? "idle" : "good",
        `${wasMember ? "Removed" : "Added"} ${shorten(normalized)} ${wasMember ? "from" : "to"} local circle ${selectedCircleData.name}.`,
        "circle",
      );
    },
    [
      appendLog,
      circleScope,
      selectedCircleData,
      selectedCircleMembers,
    ],
  );

  const lineExportExtras = useCallback(
    (item: TimelineItem) => {
      const key = item.contentHash.toLowerCase();
      const sameRpc = lineAudits[lineAuditKey(item)];
      const independent = proofAudits[proofAuditKey(item)];
      const image = imageAudits[imageAuditKey(item)];
      const cachedRecord = savedLineCache[key];
      const cachedProof =
        cachedRecord &&
        savedLineScopeMatches(cachedRecord, networkKey, contractAddress)
          ? cachedRecord.proof
          : undefined;
      return {
        publicUrl: buildLinePermalink(
          window.location.href,
          networkKey,
          contractAddress,
          item,
        ),
        local: {
          saved: savedSet.has(key),
          tracked: trackedSet.has(item.author.toLowerCase()),
          muted: mutedSet.has(item.author.toLowerCase()),
        },
        verification: {
          sameRpc: sameRpc
            ? {
                tone: sameRpc.tone,
                status: sameRpc.text,
              }
            : cachedProof?.sameRpc,
          independent: independent
            ? {
                tone: independent.tone,
                status: independent.text,
              }
            : cachedProof?.independent,
          image: image
            ? {
                tone: image.tone,
                status: image.text,
              }
            : cachedProof?.image,
        },
      };
    },
    [
      contractAddress,
      imageAuditKey,
      imageAudits,
      lineAuditKey,
      lineAudits,
      mutedSet,
      networkKey,
      proofAuditKey,
      proofAudits,
      savedLineCache,
      savedSet,
      trackedSet,
    ],
  );

  const maybeSignBundlePayload = useCallback(
    async (payload: string, label: string) => {
      if (!account || !window.ethereum) {
        return { payload, signer: "" };
      }
      appendLog("idle", `Requesting wallet signature for ${label}.`, "feed");
      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const signerAddress = await signer.getAddress();
      const signature = await signer.signMessage(getBundleSignatureMessage(payload));
      return {
        payload: attachBundleSignature(payload, signerAddress, signature),
        signer: signerAddress,
      };
    },
    [account, appendLog],
  );

  const copyVisibleFeed = useCallback(async () => {
    if (isPreviewTimeline) {
      setStatus({
        tone: "warn",
        text: "Sample posts are not exported as feed JSON.",
      });
      return;
    }
    if (feedRows.length === 0) {
      setStatus({ tone: "warn", text: "No visible feed rows to copy." });
      return;
    }
    const unchecked = feedRows.filter(
      (item) => !isSampleItem(item) && !lineTrustSnapshot(item).trusted,
    ).length;
    if (unchecked) {
      setStatus({
        tone: "warn",
        text: `Verify ${unchecked} visible line${unchecked === 1 ? "" : "s"} before copying a feed bundle.`,
      });
      appendLog(
        "warn",
        `Blocked feed bundle with ${unchecked} unchecked visible line${unchecked === 1 ? "" : "s"}.`,
        "trust",
      );
      return;
    }
    const payload = serializeFeedExport(feedRows, sigcards, {
      network: networkKey,
      chainId: network.chainId.toString(),
      contract: contractAddress,
      lineExtras: lineExportExtras,
    });
    try {
      const signed = await maybeSignBundlePayload(payload, "feed bundle");
      await navigator.clipboard.writeText(signed.payload);
      setStatus({
        tone: "good",
        text: `Copied ${signed.signer ? "signed " : ""}${feedRows.length} visible line${feedRows.length === 1 ? "" : "s"} as a public feed bundle.`,
      });
      appendLog(
        "good",
        `Copied ${signed.signer ? `signed feed bundle from ${shorten(signed.signer)} with` : "feed bundle with"} ${feedRows.length} visible line${feedRows.length === 1 ? "" : "s"}.`,
        "feed",
      );
    } catch (error) {
      const msg =
        error instanceof Error && error.message
          ? error.message
          : "Clipboard write failed. Browser permissions may have blocked it.";
      setStatus({
        tone: "bad",
        text: msg,
      });
      appendLog("bad", msg, "feed");
    }
  }, [
    appendLog,
    contractAddress,
    feedRows,
    isPreviewTimeline,
    lineExportExtras,
    lineTrustSnapshot,
    maybeSignBundlePayload,
    network.chainId,
    networkKey,
    sigcards,
  ]);

  const copyPublicReaderLink = useCallback(async () => {
    if (!contractReady) {
      setStatus({
        tone: "warn",
        text: "Set a contract address before copying a public feed link.",
      });
      return;
    }
    if (scanScope === "address" && !isAddressLike(targetAddress)) {
      setStatus({
        tone: "warn",
        text: "Enter a valid wallet address before copying an address feed link.",
      });
      return;
    }
    const href = buildPublicReaderLink(window.location.href, {
      networkKey,
      contractAddress,
      fromBlock,
      scanScope,
      targetAddress,
      feedMode,
      feedSort,
      selectedChannel,
    });
    const omittedPrivateFilters =
      Boolean(feedQuery.trim()) ||
      scanScope === "tracked" ||
      Boolean(selectedCircle) ||
      showMuted ||
      !["all", "media", "refs"].includes(feedMode);
    try {
      await navigator.clipboard.writeText(href);
      setStatus({
        tone: "good",
        text: omittedPrivateFilters
          ? "Copied a public feed link. Private filters were omitted."
          : "Copied a public feed link.",
      });
      appendLog(
        "good",
        omittedPrivateFilters
          ? "Copied public feed link with private filters omitted."
          : "Copied public feed link.",
        "feed",
      );
    } catch (error) {
      const msg =
        error instanceof Error && error.message
          ? error.message
          : "Clipboard write failed. Browser permissions may have blocked it.";
      setStatus({ tone: "bad", text: msg });
      appendLog("bad", msg, "feed");
    }
  }, [
    appendLog,
    contractAddress,
    contractReady,
    feedMode,
    feedQuery,
    feedSort,
    fromBlock,
    networkKey,
    scanScope,
    selectedChannel,
    selectedCircle,
    showMuted,
    targetAddress,
  ]);

  const copyPublicChannelLink = useCallback(
    async (channel: ChannelId) => {
      if (!contractReady) {
        setStatus({
          tone: "warn",
          text: "Set a contract address before copying a public channel link.",
        });
        return;
      }
      const href = buildPublicReaderLink(window.location.href, {
        networkKey,
        contractAddress,
        fromBlock,
        scanScope: "all",
        targetAddress: "",
        feedMode: "all",
        feedSort,
        selectedChannel: channel,
      });
      try {
        await navigator.clipboard.writeText(href);
        setStatus({
          tone: "good",
          text: `Copied public ${channelLabel(channel)} feed link.`,
        });
        appendLog("good", `Copied public ${channelLabel(channel)} feed link.`, "feed");
      } catch (error) {
        const msg =
          error instanceof Error && error.message
            ? error.message
            : "Clipboard write failed. Browser permissions may have blocked it.";
        setStatus({ tone: "bad", text: msg });
        appendLog("bad", msg, "feed");
      }
    },
    [
      appendLog,
      contractAddress,
      contractReady,
      feedSort,
      fromBlock,
      networkKey,
    ],
  );

  const copyAuthorFeedLink = useCallback(
    async (item: TimelineItem) => {
      if (isSampleItem(item)) {
        setStatus({
          tone: "warn",
          text: "Scan the contract before copying public author feed links.",
        });
        return;
      }
      if (!contractReady) {
        setStatus({
          tone: "warn",
          text: "Set a contract address before copying a public author feed link.",
        });
        return;
      }
      const href = buildPublicReaderLink(window.location.href, {
        networkKey,
        contractAddress,
        fromBlock,
        scanScope: "address",
        targetAddress: item.author,
        feedMode: "all",
        feedSort,
        selectedChannel: "",
      });
      try {
        await navigator.clipboard.writeText(href);
        setStatus({
          tone: "good",
          text: `Copied public feed link for ${shorten(item.author)}.`,
        });
        appendLog("good", `Copied public author feed link for ${shorten(item.author)}.`, "feed");
      } catch (error) {
        const msg =
          error instanceof Error && error.message
            ? error.message
            : "Clipboard write failed. Browser permissions may have blocked it.";
        setStatus({ tone: "bad", text: msg });
        appendLog("bad", msg, "feed");
      }
    },
    [
      appendLog,
      contractAddress,
      contractReady,
      feedSort,
      fromBlock,
      networkKey,
    ],
  );

  const openFeedBundleImport = useCallback(() => {
    if (!contractReady) {
      setStatus({
        tone: "warn",
        text: "Set a contract address before importing a feed bundle.",
      });
      return;
    }
    setBundleImportOpen((current) => !current);
    setBundleImportError("");
  }, [contractReady]);

  const previewFeedBundleImport = useCallback(() => {
    if (!contractReady) {
      setStatus({
        tone: "warn",
        text: "Set a contract address before importing a feed bundle.",
      });
      return;
    }
    const raw = bundleImportText.trim();
    if (!raw) {
      setBundleImportPreview(null);
      setBundleImportError("Paste a feed bundle or follow pack JSON first.");
      setStatus({
        tone: "warn",
        text: "Paste a feed bundle or follow pack JSON first.",
      });
      return;
    }
    try {
      const result = parseFeedBundleImport(raw, {
        network: networkKey,
        chainId: network.chainId.toString(),
        contract: contractAddress,
      });
      const newAuthors = result.authors.filter(
        (author) => !trackedSet.has(author.toLowerCase()),
      );
      setBundleImportPreview({ result, checkedAt: Date.now() });
      setBundleImportError("");
      setStatus({
        tone: newAuthors.length ? "idle" : "good",
        text: newAuthors.length
          ? `Preview ready. ${newAuthors.length} new wallet${newAuthors.length === 1 ? "" : "s"} can be tracked.`
          : `Preview ready. All ${result.authors.length} wallet${result.authors.length === 1 ? "" : "s"} already tracked.`,
      });
      appendLog(
        "idle",
        `Previewed ${bundleImportSourceLabel(result)} import with ${newAuthors.length} new wallet${newAuthors.length === 1 ? "" : "s"}.`,
        "feed",
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Feed bundle import failed.";
      setBundleImportPreview(null);
      setBundleImportError(msg);
      setStatus({ tone: "bad", text: msg });
      appendLog("bad", msg, "feed");
    }
  }, [
    appendLog,
    bundleImportText,
    contractAddress,
    contractReady,
    network.chainId,
    networkKey,
    trackedSet,
  ]);

  const applyFeedBundleImport = useCallback(() => {
    if (!bundleImportPreview) {
      setStatus({ tone: "warn", text: "Preview a feed bundle before importing." });
      return;
    }
    let result: FeedBundleImportResult;
    let newAuthors: string[];
    try {
      result = parseFeedBundleImport(bundleImportText.trim(), {
        network: networkKey,
        chainId: network.chainId.toString(),
        contract: contractAddress,
      });
      newAuthors = result.authors.filter(
        (author) => !trackedSet.has(author.toLowerCase()),
      );
      setBundleImportPreview({ result, checkedAt: Date.now() });
      setBundleImportError("");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Feed bundle import failed.";
      setBundleImportPreview(null);
      setBundleImportError(msg);
      setStatus({ tone: "bad", text: msg });
      appendLog("bad", msg, "feed");
      return;
    }
    if (newAuthors.length === 0) {
      setStatus({
        tone: "idle",
        text: `Import checked. All ${result.authors.length} wallet${result.authors.length === 1 ? "" : "s"} already tracked.`,
      });
      appendLog("idle", "Imported pack had no new wallets.", "feed");
      return;
    }
    const sourceLabel = bundleImportSourceLabel(result);
    resetFeedResults();
    setTrackedSigners((current) =>
      [
        ...new Set(
          [...current, ...newAuthors].map((item) => getAddress(item)),
        ),
      ].sort(),
    );
    setReaderControlsOpen(true);
    setBundleImportPreview(null);
    setBundleImportText("");
    setBundleImportError("");
    setStatus({
      tone: "good",
      text: `Tracking ${newAuthors.length} wallet${newAuthors.length === 1 ? "" : "s"} from ${result.signature ? "signed " : ""}${result.schema === "sigline.followPack.v1" ? "follow pack" : "feed bundle"}.`,
    });
    appendLog(
      "good",
      `Imported ${newAuthors.length} tracked wallet${newAuthors.length === 1 ? "" : "s"} from ${result.signature ? `signed ${sourceLabel} by ${shorten(result.signature.signer)}` : sourceLabel}.`,
      "feed",
    );
  }, [
    appendLog,
    bundleImportText,
    bundleImportPreview,
    contractAddress,
    network.chainId,
    networkKey,
    resetFeedResults,
    trackedSet,
  ]);

  const applyFeedBundleImportToCircle = useCallback(() => {
    if (!selectedCircleData || !circleScope) {
      setStatus({ tone: "warn", text: "Select a local circle before importing." });
      return;
    }
    if (!bundleImportPreview) {
      setStatus({ tone: "warn", text: "Preview a feed bundle before importing." });
      return;
    }
    let result: FeedBundleImportResult;
    let circleAuthors: string[];
    try {
      result = parseFeedBundleImport(bundleImportText.trim(), {
        network: networkKey,
        chainId: network.chainId.toString(),
        contract: contractAddress,
      });
      circleAuthors = result.authors.filter(
        (author) => !selectedCircleMembers.has(author.toLowerCase()),
      );
      setBundleImportPreview({ result, checkedAt: Date.now() });
      setBundleImportError("");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Feed bundle import failed.";
      setBundleImportPreview(null);
      setBundleImportError(msg);
      setStatus({ tone: "bad", text: msg });
      appendLog("bad", msg, "feed");
      return;
    }
    const globallyNewAuthors = result.authors.filter(
      (author) => !trackedSet.has(author.toLowerCase()),
    );
    if (circleAuthors.length === 0 && globallyNewAuthors.length === 0) {
      setStatus({
        tone: "idle",
        text: `Import checked. ${selectedCircleData.name} already has all ${result.authors.length} wallet${result.authors.length === 1 ? "" : "s"}.`,
      });
      appendLog("idle", "Imported pack had no new circle wallets.", "circle");
      return;
    }
    const sourceLabel = bundleImportSourceLabel(result);
    resetFeedResults();
    setTrackedSigners((current) =>
      [
        ...new Set(
          [...current, ...result.authors].map((item) => getAddress(item)),
        ),
      ].sort(),
    );
    setCirclesByScope((current) => ({
      ...current,
      [circleScope]: upsertCircle(
        current[circleScope] ?? [],
        selectedCircleData.name,
        result.authors,
      ),
    }));
    setReaderControlsOpen(true);
    setBundleImportPreview(null);
    setBundleImportText("");
    setBundleImportError("");
    setStatus({
      tone: "good",
      text: `Added ${circleAuthors.length} wallet${circleAuthors.length === 1 ? "" : "s"} to ${selectedCircleData.name} and tracked ${globallyNewAuthors.length} new wallet${globallyNewAuthors.length === 1 ? "" : "s"}.`,
    });
    appendLog(
      "good",
      `Imported ${circleAuthors.length} circle wallet${circleAuthors.length === 1 ? "" : "s"} and ${globallyNewAuthors.length} tracked wallet${globallyNewAuthors.length === 1 ? "" : "s"} into ${selectedCircleData.name} from ${result.signature ? `signed ${sourceLabel} by ${shorten(result.signature.signer)}` : sourceLabel}.`,
      "circle",
    );
  }, [
    appendLog,
    bundleImportText,
    bundleImportPreview,
    circleScope,
    contractAddress,
    network.chainId,
    networkKey,
    resetFeedResults,
    selectedCircleData,
    selectedCircleMembers,
    trackedSet,
  ]);

  const clearFeedBundleImport = useCallback(() => {
    setBundleImportText("");
    setBundleImportPreview(null);
    setBundleImportError("");
    setStatus({ tone: "idle", text: "Feed import cleared." });
  }, []);

  const copyVisibleDigest = useCallback(async () => {
    if (isPreviewTimeline) {
      setStatus({
        tone: "warn",
        text: "Sample posts are not copied as digests.",
      });
      return;
    }
    if (feedRows.length === 0) {
      setStatus({ tone: "warn", text: "No visible feed rows to copy." });
      return;
    }
    const unchecked = feedRows.filter(
      (item) => !isSampleItem(item) && !lineTrustSnapshot(item).trusted,
    ).length;
    if (unchecked) {
      setStatus({
        tone: "warn",
        text: `Verify ${unchecked} visible line${unchecked === 1 ? "" : "s"} before copying a digest.`,
      });
      appendLog(
        "warn",
        `Blocked feed digest with ${unchecked} unchecked visible line${unchecked === 1 ? "" : "s"}.`,
        "trust",
      );
      return;
    }
    const payload = serializeFeedDigest(feedRows, {
      network: network.short,
      contract: contractAddress,
      scope: feedProvenanceSummary?.scope,
    });
    try {
      await navigator.clipboard.writeText(payload);
      setStatus({
        tone: "good",
        text: `Copied ${feedRows.length} visible line${feedRows.length === 1 ? "" : "s"} as a local digest.`,
      });
      appendLog(
        "good",
        `Copied feed digest with ${feedRows.length} visible line${feedRows.length === 1 ? "" : "s"}.`,
        "feed",
      );
    } catch {
      setStatus({
        tone: "bad",
        text: "Clipboard write failed. Browser permissions may have blocked it.",
      });
      appendLog(
        "bad",
        "Clipboard write failed. Browser permissions may have blocked it.",
        "feed",
      );
    }
  }, [
    appendLog,
    contractAddress,
    feedProvenanceSummary?.scope,
    feedRows,
    isPreviewTimeline,
    lineTrustSnapshot,
    network.short,
  ]);

  const copyFollowPack = useCallback(async () => {
    if (!trackedSigners.length) {
      setStatus({ tone: "warn", text: "Track at least one wallet first." });
      return;
    }
    if (!contractReady) {
      setStatus({
        tone: "warn",
        text: "Set a valid contract address before copying a follow pack.",
      });
      return;
    }
    const payload = serializeFollowPackExport(trackedSigners, sigcards, {
      network: networkKey,
      chainId: network.chainId.toString(),
      contract: contractAddress,
    });
    try {
      const signed = await maybeSignBundlePayload(payload, "follow pack");
      await navigator.clipboard.writeText(signed.payload);
      setStatus({
        tone: "good",
        text: `Copied ${signed.signer ? "signed " : ""}follow pack for ${trackedSigners.length} wallet${trackedSigners.length === 1 ? "" : "s"}.`,
      });
      appendLog(
        "good",
        `Copied ${signed.signer ? `signed follow pack from ${shorten(signed.signer)} for` : "follow pack for"} ${trackedSigners.length} tracked wallet${trackedSigners.length === 1 ? "" : "s"}.`,
        "feed",
      );
    } catch (error) {
      const msg =
        error instanceof Error && error.message
          ? error.message
          : "Clipboard write failed. Browser permissions may have blocked it.";
      setStatus({
        tone: "bad",
        text: msg,
      });
      appendLog("bad", msg, "feed");
    }
  }, [
    appendLog,
    contractAddress,
    contractReady,
    maybeSignBundlePayload,
    network.chainId,
    networkKey,
    sigcards,
    trackedSigners,
  ]);

  const copyCircleFollowPack = useCallback(async () => {
    if (!selectedCircleData) {
      setStatus({ tone: "warn", text: "Select a local circle first." });
      return;
    }
    if (!selectedCircleData.addresses.length) {
      setStatus({
        tone: "warn",
        text: `Add at least one wallet to ${selectedCircleData.name} first.`,
      });
      return;
    }
    if (!contractReady) {
      setStatus({
        tone: "warn",
        text: "Set a valid contract address before copying a circle follow pack.",
      });
      return;
    }
    if (selectedCircleData.addresses.length > MAX_FEED_BUNDLE_IMPORT_AUTHORS) {
      setStatus({
        tone: "warn",
        text: `Follow packs can include at most ${MAX_FEED_BUNDLE_IMPORT_AUTHORS} wallets. Split ${selectedCircleData.name} before copying.`,
      });
      appendLog(
        "warn",
        `Blocked ${selectedCircleData.name} follow pack with ${selectedCircleData.addresses.length} wallets.`,
        "circle",
      );
      return;
    }
    const payload = serializeFollowPackExport(selectedCircleData.addresses, sigcards, {
      network: networkKey,
      chainId: network.chainId.toString(),
      contract: contractAddress,
    });
    try {
      const signed = await maybeSignBundlePayload(
        payload,
        `${selectedCircleData.name} follow pack`,
      );
      await navigator.clipboard.writeText(signed.payload);
      setStatus({
        tone: "good",
        text: `Copied ${signed.signer ? "signed " : ""}${selectedCircleData.name} follow pack for ${selectedCircleData.addresses.length} wallet${selectedCircleData.addresses.length === 1 ? "" : "s"}.`,
      });
      appendLog(
        "good",
        `Copied ${signed.signer ? `signed ${selectedCircleData.name} follow pack from ${shorten(signed.signer)} for` : `${selectedCircleData.name} follow pack for`} ${selectedCircleData.addresses.length} wallet${selectedCircleData.addresses.length === 1 ? "" : "s"}.`,
        "circle",
      );
    } catch (error) {
      const msg =
        error instanceof Error && error.message
          ? error.message
          : "Clipboard write failed. Browser permissions may have blocked it.";
      setStatus({
        tone: "bad",
        text: msg,
      });
      appendLog("bad", msg, "circle");
    }
  }, [
    appendLog,
    contractAddress,
    contractReady,
    maybeSignBundlePayload,
    network.chainId,
    networkKey,
    selectedCircleData,
    sigcards,
  ]);

  const copyLineBundle = useCallback(
    async (item: TimelineItem) => {
      if (isSampleItem(item)) {
        setStatus({ tone: "warn", text: "Sample lines are not exported." });
        return;
      }
      if (!requireTrustedLineAction(item, "copy its bundle")) return;
      const payload = serializeFeedExport([item], sigcards, {
        network: networkKey,
        chainId: network.chainId.toString(),
        contract: contractAddress,
        lineExtras: lineExportExtras,
      });
      try {
        await navigator.clipboard.writeText(payload);
        setStatus({
          tone: "good",
          text: `Copied proof bundle for ${shortHash(item.contentHash)}.`,
        });
        appendLog(
          "good",
          `Copied one-line proof bundle for ${shortHash(item.contentHash)}.`,
          "line",
        );
      } catch {
        setStatus({
          tone: "bad",
          text: "Clipboard write failed. Browser permissions may have blocked it.",
        });
        appendLog("bad", "Clipboard write failed for line bundle.", "line");
      }
    },
    [
      appendLog,
      contractAddress,
      lineExportExtras,
      network.chainId,
      networkKey,
      requireTrustedLineAction,
      sigcards,
    ],
  );

  const shareLine = useCallback(
    async (item: TimelineItem) => {
      if (isSampleItem(item)) {
        setStatus({ tone: "warn", text: "Sample lines cannot be shared." });
        return;
      }
      if (!requireTrustedLineAction(item, "share it")) return;
      const href = buildLinePermalink(
        window.location.href,
        networkKey,
        contractAddress,
        item,
      );
      try {
        await navigator.clipboard.writeText(href);
        setStatus({
          tone: "good",
          text: `Copied public link for ${shortHash(item.contentHash)}.`,
        });
        appendLog(
          "good",
          `Copied public line link for ${shortHash(item.contentHash)}.`,
          "line",
        );
      } catch {
        window.location.hash = lineId(item);
        setStatus({
          tone: "idle",
          text: `Focused line ${shortHash(item.contentHash)}.`,
        });
      }
    },
    [appendLog, contractAddress, networkKey, requireTrustedLineAction],
  );

  const shareThread = useCallback(
    async (item: TimelineItem) => {
      if (isSampleItem(item)) {
        setStatus({ tone: "warn", text: "Sample lines cannot be shared." });
        return;
      }
      if (!requireTrustedLineAction(item, "share its thread")) return;
      const href = buildThreadPermalink(
        window.location.href,
        networkKey,
        contractAddress,
        item,
      );
      try {
        await navigator.clipboard.writeText(href);
        setStatus({
          tone: "good",
          text: `Copied public thread link for ${shortHash(item.contentHash)}.`,
        });
        appendLog(
          "good",
          `Copied public thread link for ${shortHash(item.contentHash)}.`,
          "thread",
        );
      } catch {
        window.location.hash = lineId(item);
        setStatus({
          tone: "warn",
          text: "Clipboard blocked. Jumped to the line instead.",
        });
        appendLog("warn", "Clipboard blocked for thread link.", "thread");
      }
    },
    [appendLog, contractAddress, networkKey, requireTrustedLineAction],
  );

  const verifyLinePointer = useCallback(
    async (item: TimelineItem) => {
      if (!contractReady) {
        setStatus({
          tone: "warn",
          text: "Set a contract address before verifying a line.",
        });
        return;
      }
      const key = lineAuditKey(item);
      const scopeAtStart = lineAuditScope;
      const generationAtStart = lineAuditGenerationRef.current;
      const scopeStillCurrent = () => lineAuditScopeRef.current === scopeAtStart;
      const auditStillCurrent = () =>
        scopeStillCurrent() &&
        lineAuditGenerationRef.current === generationAtStart;
      setLineAudits((current) => ({
        ...current,
        [key]: { tone: "warn", text: "checking" },
      }));
      try {
        const provider = new JsonRpcProvider(
          rpcUrl || network.rpcUrl,
          Number(network.chainId),
        );
        await verifyLineWithProvider(provider, contractAddress, network, item);
        if (!auditStillCurrent()) return;
        setLineAudits((current) => ({
          ...current,
          [key]: {
            tone: "good",
            text: "same-rpc ok",
            detail:
              "Storage pointer, event receipt, and EIP-712 content commitment match on the configured RPC. Image bytes were not fetched.",
          },
        }));
        setStatus({
          tone: "good",
          text: `Same-RPC check passed for ${shortHash(item.contentHash)}.`,
        });
        appendLog(
          "good",
          `Line ${shortHash(item.contentHash)} matches storage pointer and EIP-712 content commitment.`,
          "audit",
        );
      } catch (error) {
        if (!auditStillCurrent()) return;
        const msg = getDisplayErrorMessage(error);
        setLineAudits((current) => ({
          ...current,
          [key]: { tone: "bad", text: "unverified", detail: msg },
        }));
        setStatus({ tone: "bad", text: msg });
        appendLog("bad", msg, "audit");
      }
    },
    [
      appendLog,
      contractAddress,
      contractReady,
      lineAuditKey,
      lineAuditScope,
      network,
      rpcUrl,
    ],
  );

  const verifyImageHash = useCallback(
    async (item: TimelineItem) => {
      const key = imageAuditKey(item);
      const expectedHash = item.imageHash.toLowerCase();
      if (!imageUriToGateway(item.imageUri) || expectedHash === ZERO_HASH) {
        setStatus({
          tone: "warn",
          text: "This line does not include a verifiable image.",
        });
        return;
      }
      const generationAtStart = imageAuditGenerationRef.current;
      const imageAuditStillCurrent = () =>
        imageAuditGenerationRef.current === generationAtStart;
      setImageAudits((current) => ({
        ...current,
        [key]: { tone: "warn", text: "checking" },
      }));
      try {
        const result = await verifyImageUri(item.imageUri, expectedHash, {
          useFallbackGateways: imageGatewayMode === "fallbacks",
        });
        if (!imageAuditStillCurrent()) return;
        const verifiedUrl = URL.createObjectURL(result.blob);
        setVerifiedImageUrls((current) => {
          if (current[key]) URL.revokeObjectURL(current[key]);
          const next = { ...current, [key]: verifiedUrl };
          verifiedImageUrlsRef.current = next;
          return next;
        });
        const detail = `Image bytes match ${shortHash(result.hash)} via ${shortRpc(result.url)} (${result.bytes.toLocaleString()} bytes, ${result.attempted.length} gateway${result.attempted.length === 1 ? "" : "s"} tried, ${imageGatewayMode === "fallbacks" ? "fallbacks allowed" : "configured-only"}).`;
        setImageAudits((current) => ({
          ...current,
          [key]: { tone: "good", text: "img ok", detail },
        }));
        setStatus({ tone: "good", text: detail });
        appendLog(
          "good",
          `Image for ${shortHash(item.contentHash)} matches via ${shortRpc(result.url)}.`,
          "image",
        );
      } catch (error) {
        if (!imageAuditStillCurrent()) return;
        const msg = getImageVerificationErrorMessage(error);
        setImageAudits((current) => ({
          ...current,
          [key]: { tone: "bad", text: "img bad", detail: msg },
        }));
        setStatus({ tone: "bad", text: msg });
        appendLog("bad", msg, "image");
      }
    },
    [appendLog, imageAuditKey, imageGatewayMode],
  );

  const verifyVisibleFeed = useCallback(async () => {
    if (isVerifyingFeed) return;
    if (!contractReady) {
      setStatus({
        tone: "warn",
        text: "Set a contract address before checking the feed.",
      });
      return;
    }
    const rows = [...verifiableFeedRows].slice(0, TIMELINE_LIMIT);
    if (rows.length === 0) {
      setStatus({ tone: "warn", text: "No real visible feed rows to check." });
      return;
    }
    const imageRows = rows.filter(hasVerifiableImage);
    const checkImages =
      imageRows.length > 0 &&
      window.confirm(
        `Check ${imageRows.length} image${imageRows.length === 1 ? "" : "s"} too? This fetches image bytes from ${imageGatewayMode === "fallbacks" ? "your configured gateway plus public IPFS/Arweave fallback gateways" : "only your configured IPFS/Arweave gateway"} or HTTPS hosts and may reveal which media CIDs you are checking. Press Cancel to check only line pointers.`,
      );
    const requestId = feedVerifyRequestRef.current + 1;
    feedVerifyRequestRef.current = requestId;
    const stillCurrent = () => feedVerifyRequestRef.current === requestId;
    setIsVerifyingFeed(true);
    setStatus({
      tone: "warn",
      text: `Same-RPC checking ${rows.length} visible line${rows.length === 1 ? "" : "s"}${checkImages ? ` and ${imageRows.length} image${imageRows.length === 1 ? "" : "s"}` : ""}...`,
    });
    appendLog(
      "idle",
      `Same-RPC check started for ${rows.length} visible line${rows.length === 1 ? "" : "s"}${checkImages ? `; ${imageRows.length} image${imageRows.length === 1 ? "" : "s"} will be fetched after pointer checks` : imageRows.length ? "; image byte fetch skipped" : ""}.`,
      "audit",
    );
    let lineOk = 0;
    let imageOk = 0;
    let failed = 0;
    let skippedImages = 0;
    try {
      const provider = new JsonRpcProvider(
        rpcUrl || network.rpcUrl,
        Number(network.chainId),
      );
      await assertSiglineContract(provider, contractAddress, network);
      if (!stillCurrent()) return;
      for (const item of rows) {
        if (!stillCurrent()) return;
        const lineKey = lineAuditKey(item);
        setLineAudits((current) => ({
          ...current,
          [lineKey]: { tone: "warn", text: "checking" },
        }));
        try {
          await verifyLineWithProvider(provider, contractAddress, network, item, {
            contractChecked: true,
          });
          if (!stillCurrent()) return;
          lineOk += 1;
          setLineAudits((current) => ({
            ...current,
            [lineKey]: {
              tone: "good",
              text: "same-rpc ok",
              detail:
                "Storage pointer, event receipt, and EIP-712 content commitment match on the configured RPC.",
            },
          }));
        } catch (error) {
          if (!stillCurrent()) return;
          failed += 1;
          setLineAudits((current) => ({
            ...current,
            [lineKey]: {
              tone: "bad",
              text: "unverified",
              detail: getDisplayErrorMessage(error),
            },
          }));
          continue;
        }

        if (!hasVerifiableImage(item)) continue;
        const imageKey = imageAuditKey(item);
        if (!checkImages) {
          skippedImages += 1;
          setImageAudits((current) => ({
            ...current,
            [imageKey]: {
              tone: "warn",
              text: "img skipped",
              detail:
                "Image bytes were not fetched during the visible feed check.",
            },
          }));
          continue;
        }
        if (!imageUriToGateway(item.imageUri)) {
          skippedImages += 1;
          setImageAudits((current) => ({
            ...current,
            [imageKey]: {
              tone: "warn",
              text: "img skipped",
              detail: "Unsupported image URI gateway.",
            },
          }));
          continue;
        }
        setImageAudits((current) => ({
          ...current,
          [imageKey]: { tone: "warn", text: "checking" },
        }));
        try {
          const result = await verifyImageUri(
            item.imageUri,
            item.imageHash.toLowerCase(),
            { useFallbackGateways: imageGatewayMode === "fallbacks" },
          );
          if (!stillCurrent()) return;
          const verifiedUrl = URL.createObjectURL(result.blob);
          setVerifiedImageUrls((current) => {
            if (current[imageKey]) URL.revokeObjectURL(current[imageKey]);
            const next = { ...current, [imageKey]: verifiedUrl };
            verifiedImageUrlsRef.current = next;
            return next;
          });
          imageOk += 1;
          setImageAudits((current) => ({
            ...current,
            [imageKey]: {
              tone: "good",
              text: "img ok",
              detail: `Image bytes match ${shortHash(result.hash)} via ${shortRpc(result.url)} (${result.bytes.toLocaleString()} bytes, ${result.attempted.length} gateway${result.attempted.length === 1 ? "" : "s"} tried, ${imageGatewayMode === "fallbacks" ? "fallbacks allowed" : "configured-only"}).`,
            },
          }));
        } catch (error) {
          if (!stillCurrent()) return;
          failed += 1;
          setImageAudits((current) => ({
            ...current,
            [imageKey]: {
              tone: "bad",
              text: "img bad",
              detail: getImageVerificationErrorMessage(error),
            },
          }));
        }
      }
      if (!stillCurrent()) return;
      const text = `Same-RPC check complete: ${lineOk}/${rows.length} line${rows.length === 1 ? "" : "s"} ok, ${imageOk} image${imageOk === 1 ? "" : "s"} ok${failed ? `, ${failed} failed` : ""}${skippedImages ? `, ${skippedImages} image${skippedImages === 1 ? "" : "s"} skipped` : ""}.`;
      setStatus({ tone: failed ? "warn" : "good", text });
      appendLog(failed ? "warn" : "good", text, "audit");
    } catch (error) {
      if (!stillCurrent()) return;
      const msg = getDisplayErrorMessage(error);
      setStatus({ tone: "bad", text: msg });
      appendLog(
        "bad",
        `Visible feed check failed before reading lines: ${msg}`,
        "audit",
      );
    } finally {
      if (stillCurrent()) setIsVerifyingFeed(false);
    }
  }, [
    appendLog,
    contractAddress,
    contractReady,
    imageAuditKey,
    imageGatewayMode,
    isVerifyingFeed,
    lineAuditKey,
    network,
    rpcUrl,
    verifiableFeedRows,
  ]);

  const proveVisibleFeed = useCallback(async () => {
    if (isProofingFeed) return;
    if (!contractReady) {
      setStatus({
        tone: "warn",
        text: "Set a contract address before running independent proof.",
      });
      return;
    }
    const secondRpc = proofRpcUrl.trim();
    if (!secondRpc) {
      setReaderControlsOpen(true);
      setStatus({
        tone: "warn",
        text: "Add a proof RPC endpoint before running independent proof.",
      });
      return;
    }
    const canonicalSecondRpc = canonicalizeRpcEndpoint(secondRpc);
    if (!canonicalSecondRpc) {
      setReaderControlsOpen(true);
      setStatus({
        tone: "warn",
        text: "Proof RPC must be a valid HTTP(S) URL without embedded credentials.",
      });
      return;
    }
    const primaryRpc = (rpcUrl || network.rpcUrl).trim();
    const canonicalPrimaryRpc = canonicalizeRpcEndpoint(primaryRpc);
    if (!canonicalPrimaryRpc) {
      setReaderControlsOpen(true);
      setStatus({
        tone: "warn",
        text: "Primary RPC must be a valid HTTP(S) URL without embedded credentials.",
      });
      return;
    }
    if (doRpcEndpointsShareOrigin(canonicalSecondRpc, canonicalPrimaryRpc)) {
      setReaderControlsOpen(true);
      setStatus({
        tone: "warn",
        text: "Use a proof RPC hosted on a different origin/provider.",
      });
      return;
    }
    const rows = [...verifiableFeedRows].slice(0, PROOF_BATCH_LIMIT);
    if (rows.length === 0) {
      setStatus({
        tone: "warn",
        text: "No real visible feed rows to prove.",
      });
      return;
    }

    const generationAtStart = proofAuditGenerationRef.current + 1;
    proofAuditGenerationRef.current = generationAtStart;
    const proofStillCurrent = () =>
      proofAuditGenerationRef.current === generationAtStart;
    setIsProofingFeed(true);
    setProofAudits((current) => {
      const next = { ...current };
      rows.forEach((item) => {
        next[proofAuditKey(item)] = {
          tone: "warn",
          text: "proofing",
          detail: "Checking this loaded line through the proof RPC.",
        };
      });
      return next;
    });
    setStatus({
      tone: "warn",
      text: `Independent proof checking ${rows.length} visible line${rows.length === 1 ? "" : "s"}...`,
    });
    appendLog(
      "idle",
      `Independent proof started for ${rows.length} visible line${rows.length === 1 ? "" : "s"} via ${shortRpc(secondRpc)}.`,
      "proof",
    );

    let passed = 0;
    let failed = 0;
    try {
      const provider = new JsonRpcProvider(secondRpc, Number(network.chainId));
      await assertSiglineContract(provider, contractAddress, network);
      if (!proofStillCurrent()) return;
      for (const item of rows) {
        if (!proofStillCurrent()) return;
        const key = proofAuditKey(item);
        try {
          await verifyLineWithProvider(provider, contractAddress, network, item, {
            contractChecked: true,
          });
          if (!proofStillCurrent()) return;
          passed += 1;
          setProofAudits((current) => ({
            ...current,
            [key]: {
              tone: "good",
              text: "2-rpc ok",
              detail:
                "Second RPC confirmed the stored pointer, receipt, event, and EIP-712 content commitment.",
            },
          }));
        } catch (error) {
          if (!proofStillCurrent()) return;
          failed += 1;
          const msg = getDisplayErrorMessage(error);
          const rateLimited = /429|rate|limit|quota/i.test(msg);
          setProofAudits((current) => ({
            ...current,
            [key]: {
              tone: "bad",
              text: rateLimited ? "rate-limited" : "proof failed",
              detail: msg,
            },
          }));
        }
      }
      if (!proofStillCurrent()) return;
      const text = `${passed}/${rows.length} line${rows.length === 1 ? "" : "s"} passed independent proof${failed ? `; ${failed} failed` : ""}.`;
      setStatus({ tone: failed ? "warn" : "good", text });
      appendLog(failed ? "warn" : "good", text, "proof");
    } catch (error) {
      if (!proofStillCurrent()) return;
      const msg = getDisplayErrorMessage(error);
      setProofAudits((current) => {
        const next = { ...current };
        rows.forEach((item) => {
          next[proofAuditKey(item)] = {
            tone: "bad",
            text: "proof failed",
            detail: msg,
          };
        });
        return next;
      });
      setStatus({ tone: "bad", text: msg });
      appendLog("bad", `Independent proof failed before reading lines: ${msg}`, "proof");
    } finally {
      if (proofStillCurrent()) setIsProofingFeed(false);
    }
  }, [
    appendLog,
    contractAddress,
    contractReady,
    isProofingFeed,
    network,
    proofAuditKey,
    proofRpcUrl,
    rpcUrl,
    verifiableFeedRows,
  ]);

  const hydratePermalinkLine = useCallback(async () => {
    if (
      !permalinkLineHash ||
      !permalinkAuthor ||
      !permalinkIndex ||
      !permalinkFromBlock
    ) {
      return;
    }
    if (!contractReady) {
      setStatus({
        tone: "warn",
        text: "Set a contract address before loading this line link.",
      });
      return;
    }
    const requestId = scanRequestRef.current + 1;
    scanRequestRef.current = requestId;
    feedVerifyRequestRef.current += 1;
    const scanStillCurrent = () => scanRequestRef.current === requestId;
    setFeedError("");
    setIsVerifyingFeed(false);
    invalidateLineAudits();
    invalidateProofAudits();
    invalidateImageAudits();
    try {
      setIsLoading(true);
      setStatus({ tone: "idle", text: "Loading public line link." });
      appendLog("idle", "Loading public line link.", "link");
      const provider = new JsonRpcProvider(
        rpcUrl || network.rpcUrl,
        Number(network.chainId),
      );
      await assertSiglineContract(provider, contractAddress, network);
      const index = BigInt(permalinkIndex);
      const blockNumber = parseBlock(permalinkFromBlock);
      const pointer = await readLinePointer(
        provider,
        contractAddress,
        permalinkAuthor,
        index,
      );
      if (pointer.contentHash.toLowerCase() !== permalinkLineHash) {
        throw new Error("Line link does not match the stored content hash.");
      }
      let eventBlock = blockNumber;
      if (permalinkTxHash) {
        const receipt = await provider.getTransactionReceipt(permalinkTxHash);
        if (receipt?.blockNumber !== undefined) eventBlock = receipt.blockNumber;
      }
      const contract = new Contract(contractAddress, ABI, provider);
      const events = await contract.queryFilter(
        contract.filters.PostPosted(permalinkAuthor, index),
        eventBlock,
        eventBlock,
      );
      const item = events
        .filter((event): event is EventLog => event instanceof EventLog)
        .map((event) => toTimelineItem(event))
        .find(
          (eventItem) =>
            eventItem.contentHash.toLowerCase() === permalinkLineHash &&
            (!permalinkTxHash ||
              eventItem.txHash.toLowerCase() === permalinkTxHash),
        );
      if (!item) {
        throw new Error("Line event was not found at the linked block.");
      }
      const pointerAudit = getPointerAuditResult(
        item,
        pointer,
        contractAddress,
        network.chainId,
      );
      if (!pointerAudit.ok) throw new Error(pointerAudit.detail);
      if (
        computePostContentHash(
          contractAddress,
          network.chainId,
          item,
        ).toLowerCase() !== permalinkLineHash
      ) {
        throw new Error("Line event does not match its content commitment.");
      }
      if (!scanStillCurrent()) return;
      setScanScope("address");
      setTargetAddress(permalinkAuthor);
      setFromBlock(String(item.blockNumber));
      setNextScanBlock(String(item.blockNumber + 1));
      setFeedQuery("");
      setFeedMode("all");
      setTimeline([item]);
      setHasQueriedTimeline(true);
      setFeedProvenance({
        kind: "link",
        scope: shorten(permalinkAuthor),
        rpc: shortRpc(rpcUrl || network.rpcUrl),
        loaded: 1,
        totalLoaded: 1,
        scannedFromBlock: eventBlock,
        scannedToBlock: eventBlock,
        at: Date.now(),
      });
      setFeedError("");
      setReaderControlsOpen(false);
      const key = lineAuditKey(item);
      setLineAudits({
        [key]: {
          tone: "good",
          text: "link ok",
          detail:
            "Public link, stored pointer, event, and EIP-712 content commitment match.",
        },
      });
      const text = `Loaded public line ${shortHash(item.contentHash)}.`;
      setStatus({ tone: "good", text });
      appendLog("good", text, "link");
      setScanFlash((n) => n + 1);
    } catch (error) {
      if (!scanStillCurrent()) return;
      const msg = getPermalinkErrorMessage(error);
      setTimeline([]);
      setHasQueriedTimeline(true);
      setFeedError(msg);
      setFeedProvenance(null);
      setStatus({ tone: "bad", text: msg });
      appendLog("bad", msg, "link");
    } finally {
      if (scanStillCurrent()) setIsLoading(false);
    }
  }, [
    appendLog,
    contractAddress,
    contractReady,
    invalidateImageAudits,
    invalidateLineAudits,
    invalidateProofAudits,
    lineAuditKey,
    network,
    permalinkAuthor,
    permalinkFromBlock,
    permalinkIndex,
    permalinkLineHash,
    permalinkTxHash,
    rpcUrl,
  ]);

  const answerLine = useCallback(
    (item: TimelineItem) => {
      if (isSampleItem(item)) {
        setStatus({
          tone: "warn",
          text: "Scan the contract before answering real lines.",
        });
        return;
      }
      if (!requireTrustedLineAction(item, "answer it")) return;
      setAnsweringTo(item);
      setEchoingTo(null);
      setStatus({
        tone: "idle",
        text: `Answering ${shortHash(item.contentHash)}.`,
      });
      appendLog("idle", `Answering line ${shortHash(item.contentHash)}.`, "line");
      window.location.hash = "transmit";
    },
    [appendLog, requireTrustedLineAction],
  );

  const echoLine = useCallback(
    (item: TimelineItem) => {
      if (isSampleItem(item)) {
        setStatus({
          tone: "warn",
          text: "Scan the contract before echoing real lines.",
        });
        return;
      }
      if (!requireTrustedLineAction(item, "echo it")) return;
      setEchoingTo(item);
      setAnsweringTo(null);
      setStatus({
        tone: "idle",
        text: `Echoing ${shortHash(item.contentHash)}.`,
      });
      appendLog("idle", `Echoing line ${shortHash(item.contentHash)}.`, "line");
      window.location.hash = "transmit";
    },
    [appendLog, requireTrustedLineAction],
  );

  const loadVerifiedLineThread = useCallback(
    async (item: TimelineItem, baseTimeline: TimelineItem[] = timeline) => {
      if (!contractReady) {
        setStatus({
          tone: "warn",
          text: "Set a contract address before loading thread activity.",
        });
        return;
      }
      const key = item.contentHash.toLowerCase();
      const requestId = threadRequestRef.current + 1;
      threadRequestRef.current = requestId;
      const threadStillCurrent = () => threadRequestRef.current === requestId;
      const requestRpcHost = shortRpc(rpcUrl || network.rpcUrl);
      try {
        setThreadLoadingHash(key);
        setFeedError("");
        appendLog(
          "idle",
          `Loading thread activity for ${shortHash(item.contentHash)}…`,
          "thread",
        );
        const provider = new JsonRpcProvider(
          rpcUrl || network.rpcUrl,
          Number(network.chainId),
        );
        await assertSiglineContract(provider, contractAddress, network);
        const contract = new Contract(contractAddress, ABI, provider);
        const filter = contract.filters.PostPosted(
          undefined,
          undefined,
          item.contentHash,
        );
        const { events, latestBlock, scannedFromBlock, scannedToBlock } =
          await queryPostEvents(
            provider,
            contract,
            [filter],
            item.blockNumber,
            TIMELINE_LIMIT,
            THREAD_SCAN_BLOCK_WINDOW,
            "latest",
          );
        if (!threadStillCurrent()) return;
        const parsed = events
          .filter((event): event is EventLog => event instanceof EventLog)
          .map((event) => toTimelineItem(event))
          .filter(
            (child) =>
              child.contentHash.toLowerCase() !== key &&
              child.refHash.toLowerCase() === key,
          )
          .sort(
            (a, b) => b.createdAt - a.createdAt || Number(b.index - a.index),
          )
          .slice(0, TIMELINE_LIMIT);
        const rangeLabel = `blocks ${scannedFromBlock.toLocaleString()}-${scannedToBlock.toLocaleString()}`;
        const nextRows = takeTimelineRows(
          mergeTimelineItems(parsed, baseTimeline),
          item.contentHash,
        );
        setTimeline(nextRows);
        setFeedProvenance({
          kind: "thread",
          scope: shortHash(item.contentHash),
          rpc: requestRpcHost,
          loaded: parsed.length,
          totalLoaded: nextRows.length,
          scannedFromBlock,
          scannedToBlock,
          latestBlock,
          at: Date.now(),
        });
        setThreadLoadedHashes((current) => ({ ...current, [key]: Date.now() }));
        setHasQueriedTimeline(true);
        const tone: StatusTone = parsed.length ? "good" : "idle";
        const text = parsed.length
          ? `Loaded ${parsed.length} thread reference${parsed.length === 1 ? "" : "s"} from ${rangeLabel}.`
          : `No thread references found in ${rangeLabel}.`;
        setStatus({ tone, text });
        appendLog(tone, text, "thread");
      } catch (error) {
        if (!threadStillCurrent()) return;
        const msg = getDisplayErrorMessage(error);
        setStatus({ tone: "bad", text: msg });
        appendLog("bad", msg, "thread");
      } finally {
        if (threadStillCurrent()) {
          setThreadLoadingHash((current) => (current === key ? "" : current));
        }
      }
    },
    [appendLog, contractAddress, contractReady, network, rpcUrl, timeline],
  );

  const loadLineThread = useCallback(
    async (item: TimelineItem) => {
      if (isSampleItem(item)) {
        setStatus({
          tone: "warn",
          text: "Scan the contract before loading real thread activity.",
        });
        return;
      }
      if (!requireTrustedLineAction(item, "load its thread")) return;
      await loadVerifiedLineThread(item);
    },
    [loadVerifiedLineThread, requireTrustedLineAction],
  );

  useEffect(() => {
    if (
      permalinkThreadAutoloadedRef.current ||
      !permalinkShouldAutoLoad ||
      !permalinkWantsThread ||
      !permalinkLineHash
    ) {
      return;
    }
    const linkedLine = timeline.find(
      (item) => item.contentHash.toLowerCase() === permalinkLineHash,
    );
    if (!linkedLine || !lineTrustSnapshot(linkedLine).trusted) return;
    permalinkThreadAutoloadedRef.current = true;
    void loadVerifiedLineThread(linkedLine, [linkedLine]);
  }, [
    lineTrustSnapshot,
    loadVerifiedLineThread,
    permalinkLineHash,
    permalinkShouldAutoLoad,
    permalinkWantsThread,
    timeline,
  ]);

  const loadTimeline = useCallback(async (options: ScanOptions = {}) => {
    const requestId = scanRequestRef.current + 1;
    scanRequestRef.current = requestId;
    feedVerifyRequestRef.current += 1;
    const scanStillCurrent = () => scanRequestRef.current === requestId;
    const requestScopeLabel = scanScopeLabel;
    const requestRpcHost = shortRpc(rpcUrl || network.rpcUrl);
    setFeedError("");
    setIsVerifyingFeed(false);
    invalidateLineAudits();
    invalidateProofAudits();
    invalidateImageAudits();
    if (!contractReady) {
      setIsLoading(false);
      setStatus({
        tone: "warn",
        text: "Set a contract address before scanning.",
      });
      return;
    }
    const normalizedTarget = targetAddress.trim();
    if (scanScope === "address" && !normalizedTarget) {
      setIsLoading(false);
      setStatus({ tone: "warn", text: "Enter a wallet address to scan." });
      return;
    }
    if (normalizedTarget && !isAddressLike(normalizedTarget)) {
      setIsLoading(false);
      setStatus({
        tone: "warn",
        text: "That author address doesn't look valid.",
      });
      return;
    }
    if (scanScope === "tracked" && trackedScanSigners.length === 0) {
      setIsLoading(false);
      setStatus({
        tone: "warn",
        text: selectedCircleData
          ? `Add at least one wallet to ${selectedCircleData.name} first.`
          : "Track at least one wallet first.",
      });
      return;
    }
    const mergeNewer = Boolean(options.merge);
    const scanOlder = Boolean(options.older);
    const requestedFromBlock = options.startBlock ?? fromBlock;
    try {
      setIsLoading(true);
      appendLog(
        "idle",
        mergeNewer
          ? `Scanning from block ${requestedFromBlock}…`
          : scanOlder
            ? `Scanning older blocks ending at ${options.endBlock ?? "latest"}…`
          : scanScope === "tracked"
          ? `Scanning ${trackedScanSigners.length} ${selectedCircleData ? `${selectedCircleData.name} circle` : "tracked"} wallet${trackedScanSigners.length === 1 ? "" : "s"}…`
          : "Scanning for posts…",
        "scan",
      );
      const provider = new JsonRpcProvider(
        rpcUrl || network.rpcUrl,
        Number(network.chainId),
      );
      await assertSiglineContract(provider, contractAddress, network);
      const contract = new Contract(contractAddress, ABI, provider);
      const startBlock = parseBlock(requestedFromBlock);
      const endBlock = options.endBlock ? parseBlock(options.endBlock) : undefined;
      const signers =
        scanScope === "tracked"
          ? trackedScanSigners
          : scanScope === "address"
            ? [getAddress(normalizedTarget)]
            : [];
      const filters = signers.length
        ? signers.map((address) => contract.filters.PostPosted(address))
        : [contract.filters.PostPosted()];
      const windowAnchor = mergeNewer ? "forward" : "latest";
      const { events, latestBlock, scannedFromBlock, scannedToBlock } =
        await queryPostEvents(
        provider,
        contract,
        filters,
        startBlock,
        mergeNewer ? Number.POSITIVE_INFINITY : TIMELINE_LIMIT,
        mergeNewer ? NEWER_SCAN_BLOCK_WINDOW : INITIAL_SCAN_BLOCK_WINDOW,
        windowAnchor,
          { endBlock },
      );
      const parsed = events
        .filter((event): event is EventLog => event instanceof EventLog)
        .map((event) => toTimelineItem(event))
        .sort((a, b) => b.createdAt - a.createdAt || Number(b.index - a.index));
      if (!scanStillCurrent()) return;
      const hasNewerWindow = scannedToBlock < latestBlock;
      const hasOlderWindow = scannedFromBlock > startBlock;
      const rangeLabel = `blocks ${scannedFromBlock.toLocaleString()}-${scannedToBlock.toLocaleString()}`;
      setNextScanBlock(
        String(hasNewerWindow ? scannedToBlock + 1 : latestBlock + 1),
      );
      setOlderScanBlock(hasOlderWindow ? String(scannedFromBlock - 1) : "");
      const nextRows =
        mergeNewer || scanOlder
          ? takeTimelineRows(
              mergeTimelineItems(parsed, timeline),
              permalinkLineHash,
            )
          : takeTimelineRows(parsed, permalinkLineHash);
      setTimeline(nextRows);
      setHasQueriedTimeline(true);
      setFeedProvenance({
        kind: mergeNewer ? "newer" : scanOlder ? "older" : "latest",
        scope: requestScopeLabel,
        rpc: requestRpcHost,
        loaded: parsed.length,
        totalLoaded: nextRows.length,
        scannedFromBlock,
        scannedToBlock,
        latestBlock,
        at: Date.now(),
      });
      setFeedError("");
      if (!mergeNewer) setReaderControlsOpen(false);
      const tone: StatusTone = parsed.length ? "good" : "idle";
      const moreNewer = mergeNewer && hasNewerWindow;
      const text = parsed.length
        ? mergeNewer
          ? `Loaded ${parsed.length} newer post${parsed.length === 1 ? "" : "s"} from ${rangeLabel}${moreNewer ? "; more newer blocks remain." : "."}`
          : scanOlder
            ? `Loaded ${parsed.length} older post${parsed.length === 1 ? "" : "s"} from ${rangeLabel}${hasOlderWindow ? "; older blocks remain." : "."}`
            : `Loaded ${parsed.length} post${parsed.length === 1 ? "" : "s"} from ${rangeLabel}${hasOlderWindow ? "; older blocks remain." : "."}`
        : mergeNewer
          ? moreNewer
            ? `No newer posts found in ${rangeLabel}; more newer blocks remain.`
            : "No newer posts found."
          : scanOlder
            ? `No older posts found in ${rangeLabel}${hasOlderWindow ? "; older blocks remain." : "."}`
            : `No posts found in ${rangeLabel}${hasOlderWindow ? "; older blocks remain." : "."}`;
      setStatus({ tone, text });
      appendLog(tone, text, "scan");
      if (parsed.length) setScanFlash((n) => n + 1);
    } catch (error) {
      if (!scanStillCurrent()) return;
      const msg = getDisplayErrorMessage(error);
      if (!mergeNewer && !scanOlder) {
        setTimeline([]);
        setHasQueriedTimeline(true);
        setFeedError(msg);
        setFeedProvenance(null);
        setNextScanBlock("");
        setOlderScanBlock("");
      }
      setStatus({ tone: "bad", text: msg });
      appendLog("bad", msg, "scan");
    } finally {
      if (scanStillCurrent()) setIsLoading(false);
    }
  }, [
    appendLog,
    contractAddress,
    contractReady,
    fromBlock,
    invalidateImageAudits,
    invalidateLineAudits,
    invalidateProofAudits,
    network,
    permalinkLineHash,
    rpcUrl,
    scanScopeLabel,
    scanScope,
    selectedCircleData,
    targetAddress,
    timeline,
    trackedScanSigners,
  ]);

  useEffect(() => {
    if (
      publicReaderAutoloadedRef.current ||
      !publicReaderLink.isReaderLink ||
      !publicReaderLink.shouldAutoLoad
    ) {
      return;
    }
    if (!contractReady) return;
    publicReaderAutoloadedRef.current = true;
    void loadTimeline();
  }, [
    contractReady,
    loadTimeline,
    publicReaderLink.isReaderLink,
    publicReaderLink.shouldAutoLoad,
  ]);

  useEffect(() => {
    if (permalinkAutoloadedRef.current || !permalinkShouldAutoLoad) return;
    if (!contractReady) return;
    permalinkAutoloadedRef.current = true;
    void hydratePermalinkLine();
  }, [
    contractReady,
    hydratePermalinkLine,
    permalinkShouldAutoLoad,
  ]);

  const clearImage = useCallback(() => {
    imageSelectionGenerationRef.current += 1;
    draftImageVerificationRef.current += 1;
    setIsUploadingImage(false);
    setImageFile(null);
    setImageUpload(null);
    setDraftImagePointer(null);
    setImagePreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return "";
    });
  }, []);

  const selectImage = useCallback(
    (file: File | null) => {
      imageSelectionGenerationRef.current += 1;
      draftImageVerificationRef.current += 1;
      setIsUploadingImage(false);
      setImageUpload(null);
      setDraftImagePointer(null);
      setImageFile(null);
      setImagePreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return "";
      });
      if (!file) return;
      if (!hasImagePass) {
        setStatus({
          tone: "warn",
          text: imagePassLoading
            ? "Checking image pass. Try again in a moment."
            : "Buy an image pass before selecting images.",
        });
        return;
      }
      try {
        validateImageFile(file);
      } catch (error) {
        setStatus({
          tone: "warn",
          text: error instanceof Error ? error.message : "Image rejected.",
        });
        return;
      }
      setImageFile(file);
      setImagePreviewUrl(URL.createObjectURL(file));
      setStatus({
        tone: "idle",
        text: "Image ready. It will upload before posting.",
      });
    },
    [hasImagePass, imagePassLoading],
  );

  const clearCompose = useCallback(() => {
    setPostText("");
    setAnsweringTo(null);
    setEchoingTo(null);
    clearImage();
    setActiveDraftId("");
    setStatus({ tone: "idle", text: "Compose cleared." });
    appendLog("idle", "Cleared compose.", "draft");
  }, [appendLog, clearImage]);

  const saveComposeDraft = useCallback(() => {
    if (imageFile && !imageUpload) {
      setStatus({
        tone: "warn",
        text: "Upload the selected image before saving it to the draft queue.",
      });
      return;
    }
    const now = Date.now();
    const draft = createLocalDraft({
      id: activeDraftId || undefined,
      now,
      networkKey,
      contractAddress,
      text: postText,
      imageUri: imageUpload?.uri ?? draftImagePointer?.uri ?? "",
      imageHash: imageUpload?.hash ?? draftImagePointer?.hash ?? "",
      reference: composeDraftReference,
    });
    if (!draft) {
      setStatus({
        tone: "warn",
        text: "Nothing draftable yet. Add text, an uploaded image, or a reference.",
      });
      return;
    }
    const existing = activeDraftId
      ? draftQueue.find((item) => item.id === activeDraftId)
      : undefined;
    const storedDraft = existing
      ? { ...draft, createdAt: existing.createdAt, updatedAt: now }
      : draft;
    setDraftQueue((current) => upsertDraft(current, storedDraft));
    setActiveDraftId(storedDraft.id);
    setStatus({ tone: "good", text: "Saved compose to local draft queue." });
    appendLog("good", "Saved compose to local draft queue.", "draft");
  }, [
    activeDraftId,
    appendLog,
    composeDraftReference,
    contractAddress,
    draftQueue,
    draftImagePointer,
    imageFile,
    imageUpload,
    networkKey,
    postText,
  ]);

  const loadDraft = useCallback(
    (draft: LocalDraft) => {
      imageSelectionGenerationRef.current += 1;
      const verificationRequest = draftImageVerificationRef.current + 1;
      draftImageVerificationRef.current = verificationRequest;
      setIsUploadingImage(false);
      const contractChanges =
        draft.contractAddress &&
        draft.contractAddress.toLowerCase() !== contractAddress.toLowerCase();
      if (draft.networkKey !== networkKey || contractChanges) {
        resetFeedResults();
      }
      if (draft.contractAddress) {
        composeScopeRef.current = `${draft.networkKey}:${draft.contractAddress.toLowerCase()}`;
      }
      if (draft.networkKey !== networkKey) {
        setNetworkKey(draft.networkKey);
        setRpcUrl(NETWORKS[draft.networkKey].rpcUrl);
      }
      if (draft.contractAddress) {
        setContractsByNetwork((current) => ({
          ...current,
          [draft.networkKey]: draft.contractAddress,
        }));
      }
      setPostText(draft.text);
      const referenceItem = draft.reference
        ? draftReferenceToTimelineItem(draft.reference as DraftReference)
        : null;
      setAnsweringTo(
        draft.reference?.mode === "reply" && referenceItem ? referenceItem : null,
      );
      setEchoingTo(
        draft.reference?.mode === "echo" && referenceItem ? referenceItem : null,
      );
      setImageFile(null);
      setImageUpload(null);
      const storedImage =
        draft.imageUri && draft.imageHash
          ? { uri: draft.imageUri, hash: draft.imageHash }
          : null;
      const verificationScope = [
        draft.networkKey,
        (draft.contractAddress || contractAddress).toLowerCase(),
        draft.id,
      ].join(":");
      setDraftImagePointer(storedImage);
      setImagePreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return "";
      });
      setActiveDraftId(draft.id);
      setStatus({ tone: "idle", text: `Loaded draft ${draftLabel(draft)}.` });
      appendLog("idle", `Loaded local draft ${draftLabel(draft)}.`, "draft");
      if (storedImage) {
        appendLog("idle", `Verifying draft image at ${storedImage.uri}.`, "image");
        void verifyImageUri(storedImage.uri, storedImage.hash, {
          useFallbackGateways: imageGatewayMode === "fallbacks",
        })
          .then((verified) => {
            if (
              draftImageVerificationRef.current !== verificationRequest ||
              draftImageScopeRef.current !== verificationScope
            ) {
              return;
            }
            const previewUrl = URL.createObjectURL(verified.blob);
            setImageUpload({
              uri: storedImage.uri,
              hash: verified.hash,
              gatewayUrl: verified.url,
              bytes: verified.bytes,
              mime: verified.mime,
            });
            setDraftImagePointer(null);
            setImagePreviewUrl((current) => {
              if (current) URL.revokeObjectURL(current);
              return previewUrl;
            });
            setStatus({ tone: "good", text: `Loaded draft ${draftLabel(draft)}.` });
            appendLog("good", `Verified draft image at ${storedImage.uri}.`, "image");
          })
          .catch((error) => {
            if (
              draftImageVerificationRef.current !== verificationRequest ||
              draftImageScopeRef.current !== verificationScope
            ) {
              return;
            }
            const msg =
              error instanceof Error
                ? error.message
                : "Draft image verification failed.";
            setStatus({ tone: "warn", text: msg });
            appendLog("warn", msg, "image");
          });
      }
      window.location.hash = "transmit";
    },
    [
      appendLog,
      contractAddress,
      imageGatewayMode,
      networkKey,
      resetFeedResults,
    ],
  );

  const discardDraft = useCallback(
    (id: string) => {
      setDraftQueue((current) => deleteDraft(current, id));
      if (activeDraftId === id) setActiveDraftId("");
      setStatus({ tone: "idle", text: "Deleted local draft." });
      appendLog("idle", "Deleted local draft.", "draft");
    },
    [activeDraftId, appendLog],
  );

  const uploadSelectedImage = useCallback(async () => {
    if (!imageFile) return null;
    if (!hasImagePass) {
      setStatus({
        tone: "warn",
        text: imagePassLoading
          ? "Checking image pass. Try again in a moment."
          : "Buy an image pass before uploading images.",
      });
      return null;
    }
    const selectedFile = imageFile;
    const selectionGeneration = imageSelectionGenerationRef.current;
    const selectionStillCurrent = () =>
      imageSelectionGenerationRef.current === selectionGeneration;
    setIsUploadingImage(true);
    try {
      appendLog("idle", `Uploading image via ${imageUploadMode}.`, "image");
      const uploaded = await uploadImage(
        selectedFile,
        imageUploadMode,
        imageUploadEndpoint,
        { useFallbackGateways: imageGatewayMode === "fallbacks" },
      );
      if (selectionStillCurrent()) setImageUpload(uploaded);
      appendLog("good", `Image stored at ${uploaded.uri}.`, "image");
      return uploaded;
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Image upload failed.";
      if (selectionStillCurrent()) setStatus({ tone: "bad", text: msg });
      appendLog("bad", msg, "image");
      return null;
    } finally {
      if (selectionStillCurrent()) setIsUploadingImage(false);
    }
  }, [
    appendLog,
    hasImagePass,
    imageFile,
    imagePassLoading,
    imageUploadEndpoint,
    imageUploadMode,
    imageGatewayMode,
  ]);

  const publishPost = useCallback(async () => {
    if (!contractReady) {
      setStatus({
        tone: "warn",
        text: "Set a contract address before posting.",
      });
      return;
    }
    if (draftImagePointer) {
      setStatus({
        tone: "warn",
        text: "Draft image must pass verification before posting.",
      });
      return;
    }
    if (!postText.trim() && !imageFile && !imageUpload && !hasReferenceTarget) {
      setStatus({
        tone: "warn",
        text: "Write something, add an image, or reference a line first.",
      });
      return;
    }
    if (postBytes > MAX_POST_BYTES) {
      setStatus({
        tone: "warn",
        text: `Keep posts to ${MAX_POST_BYTES} bytes. This one is ${postBytes}.`,
      });
      return;
    }
    if ((imageFile || imageUpload) && !hasImagePass) {
      setStatus({
        tone: "warn",
        text: imagePassLoading
          ? "Checking image pass. Try again in a moment."
          : "Buy an image pass before posting images.",
      });
      return;
    }
    if (postBlockedByTreasury) {
      setStatus({
        tone: "warn",
        text: "Configure the expected treasury before posting.",
      });
      return;
    }
    const refLine = answeringTo ?? echoingTo;
    if (refLine && isSampleItem(refLine)) {
      setStatus({
        tone: "warn",
        text: "Sample lines cannot be used as references.",
      });
      return;
    }
    const publishNetwork = network;
    const publishContractAddress = contractAddress;
    const publishRpcUrl = rpcUrl || publishNetwork.rpcUrl;
    const publishScope = publishUiScope;
    const publishRequest = publishRequestRef.current + 1;
    publishRequestRef.current = publishRequest;
    const publishStillCurrent = () =>
      publishRequestRef.current === publishRequest &&
      publishUiScopeRef.current === publishScope;
    const publishText = postText.trim();
    const publishImageFile = imageFile;
    const publishImageUpload = imageUpload;
    const publishDraftId = activeDraftId;
    const refKind = answeringTo
      ? REF_KIND_REPLY
      : echoingTo
        ? REF_KIND_ECHO
        : REF_KIND_NONE;
    const refHash = refLine?.contentHash ?? ZERO_HASH;
    const verifyReferenceForPublish = async (stage: "preflight" | "final") => {
      if (!refLine) return;
      failureTag = "trust";
      const stageLabel = stage === "preflight" ? "Preflight" : "Final";
      if (publishStillCurrent()) {
        setStatus({
          tone: "idle",
          text: `${stageLabel} checking referenced line ${shortHash(refLine.contentHash)}…`,
        });
      }
      appendLog(
        "idle",
        `${stageLabel} checking reference ${shortHash(refLine.contentHash)}.`,
        "trust",
      );
      const provider = new JsonRpcProvider(
        publishRpcUrl,
        Number(publishNetwork.chainId),
      );
      await verifyLineWithProvider(
        provider,
        publishContractAddress,
        publishNetwork,
        refLine,
      );
      if (publishStillCurrent()) {
        setLineAudits((current) => ({
          ...current,
          [lineAuditKey(refLine)]: {
            tone: "good",
            text: stage === "preflight" ? "preflight ok" : "final ok",
            detail:
              "Reference pointer, receipt event, and EIP-712 content commitment matched before posting.",
          },
        }));
      }
      appendLog(
        "good",
        `Reference ${shortHash(refLine.contentHash)} passed ${stage} same-RPC check.`,
        "trust",
      );
    };
    let failureTag = "tx";
    try {
      setIsPosting(true);
      if (refLine && publishImageFile) {
        await verifyReferenceForPublish("preflight");
      }
      failureTag = "tx";
      const uploaded =
        publishImageUpload ||
        (publishImageFile ? await uploadSelectedImage() : null);
      if (publishImageFile && !uploaded) return;
      appendLog("idle", "Preparing post…", "post");
      await ensureWalletOnNetwork(publishNetwork);
      const contract = await writableContract(
        publishContractAddress,
        publishNetwork,
      );
      if (refLine) await verifyReferenceForPublish("final");
      failureTag = "tx";
      const imageUri = uploaded?.uri ?? "";
      const imageHash = uploaded?.hash ?? ZERO_HASH;
      const tx =
        refKind === REF_KIND_NONE
          ? await contract.post(publishText, imageUri, imageHash)
          : await contract.postWithReference(
              publishText,
              imageUri,
              imageHash,
              refHash,
              refKind,
            );
      if (publishStillCurrent()) {
        setStatus({
          tone: "idle",
          text: "Submitted. Waiting for confirmation…",
        });
      }
      appendLog("idle", `Submitted tx ${shorten(tx.hash)}`, "post");
      const receipt = await tx.wait();
      appendLog(
        "good",
        `Confirmed in block ${receipt.blockNumber} (${shorten(receipt.hash)}).`,
        "post",
      );
      if (!publishStillCurrent()) return;
      setLastTx(receipt.hash);
      setStatus({ tone: "good", text: "Post confirmed." });
      setPostFlash((n) => n + 1);
      if (publishDraftId) {
        setDraftQueue((current) => deleteDraft(current, publishDraftId));
        setActiveDraftId("");
      }
      setPostText("");
      setAnsweringTo(null);
      setEchoingTo(null);
      clearImage();
      setBalanceRefresh((n) => n + 1);
      await loadTimeline();
    } catch (error) {
      const msg = getDisplayErrorMessage(error);
      if (publishStillCurrent()) setStatus({ tone: "bad", text: msg });
      appendLog("bad", msg, failureTag);
    } finally {
      if (publishRequestRef.current === publishRequest) setIsPosting(false);
    }
  }, [
    appendLog,
    activeDraftId,
    answeringTo,
    clearImage,
    contractAddress,
    contractReady,
    draftImagePointer,
    echoingTo,
    hasImagePass,
    hasReferenceTarget,
    imageFile,
    imagePassLoading,
    imageUpload,
    lineAuditKey,
    loadTimeline,
    network,
    postBytes,
    postBlockedByTreasury,
    postText,
    publishUiScope,
    rpcUrl,
    uploadSelectedImage,
  ]);

  const publishProfile = useCallback(async () => {
    if (!contractReady) {
      setStatus({
        tone: "warn",
        text: "Set a contract address first.",
      });
      return;
    }
    if (!nick.trim()) {
      setStatus({ tone: "warn", text: "Pick an alias first." });
      return;
    }
    if (!expectedTreasuryConfigured) {
      setStatus({
        tone: "warn",
        text: "Configure the expected treasury before saving identity.",
      });
      return;
    }
    const nextTwtUrl = twtUrl.trim();
    if (nextTwtUrl && !safeExternalHref(nextTwtUrl)) {
      setStatus({
        tone: "warn",
        text: "Use an http:// or https:// URL for your twtxt link.",
      });
      return;
    }
    try {
      setIsSealingId(true);
      setIdentityAction("save");
      appendLog("idle", "Preparing identity update…", "identity");
      await ensureWalletOnNetwork(network);
      const contract = await writableContract(contractAddress, network);
      const tx = await contract.setProfile(nick.trim(), nextTwtUrl);
      setStatus({
        tone: "idle",
        text: "Submitted. Waiting for confirmation…",
      });
      appendLog("idle", `Submitted tx ${shorten(tx.hash)}`, "identity");
      const receipt = await tx.wait();
      setLastTx(receipt.hash);
      setStatus({ tone: "good", text: "Identity updated." });
      appendLog(
        "good",
        `Confirmed in block ${receipt.blockNumber} (${shorten(receipt.hash)}).`,
        "identity",
      );
      setIdFlash((n) => n + 1);
      setSigcardRefresh((n) => n + 1);
      setBalanceRefresh((n) => n + 1);
    } catch (error) {
      const msg = getDisplayErrorMessage(error);
      setStatus({ tone: "bad", text: msg });
      appendLog("bad", msg, "tx");
    } finally {
      setIsSealingId(false);
      setIdentityAction("");
    }
  }, [
    appendLog,
    contractAddress,
    contractReady,
    expectedTreasuryConfigured,
    network,
    nick,
    twtUrl,
  ]);

  const clearProfile = useCallback(async () => {
    if (!contractReady) {
      setStatus({
        tone: "warn",
        text: "Set a contract address first.",
      });
      return;
    }
    if (!expectedTreasuryConfigured) {
      setStatus({
        tone: "warn",
        text: "Configure the expected treasury before clearing identity.",
      });
      return;
    }
    if (!account) {
      setStatus({ tone: "warn", text: "Connect a wallet before clearing alias." });
      return;
    }
    if (!chainAligned) {
      setStatus({ tone: "warn", text: `Switch to ${network.short} first.` });
      return;
    }
    const confirmed = window.confirm(
      `Clear the current alias and twtxt URL for ${shorten(account)} on ${network.short}? Posts and historical events stay public.`,
    );
    if (!confirmed) return;
    const confirmedAccount = getAddress(account);
    const clearScope = walletContractScope;
    const clearRequest = identityRequestRef.current + 1;
    identityRequestRef.current = clearRequest;
    const clearStillCurrent = () =>
      identityRequestRef.current === clearRequest &&
      walletContractScopeRef.current === clearScope;
    try {
      setIsSealingId(true);
      setIdentityAction("clear");
      appendLog("idle", "Preparing identity clear…", "identity");
      await ensureWalletOnNetwork(network);
      const contract = await writableContract(contractAddress, network, {
        expectedSigner: confirmedAccount,
      });
      const tx = await contract.clearProfile();
      if (clearStillCurrent()) {
        setStatus({
          tone: "idle",
          text: "Submitted. Waiting for confirmation…",
        });
      }
      appendLog("idle", `Submitted tx ${shorten(tx.hash)}`, "identity");
      const receipt = await tx.wait();
      if (!clearStillCurrent()) return;
      setLastTx(receipt.hash);
      setNick("");
      setTwtUrl("");
      setStatus({ tone: "good", text: "Current alias and twtxt URL cleared." });
      appendLog(
        "good",
        `Cleared in block ${receipt.blockNumber} (${shorten(receipt.hash)}).`,
        "identity",
      );
      setIdFlash((n) => n + 1);
      setSigcardRefresh((n) => n + 1);
      setBalanceRefresh((n) => n + 1);
    } catch (error) {
      const msg = getDisplayErrorMessage(error);
      if (clearStillCurrent()) setStatus({ tone: "bad", text: msg });
      appendLog("bad", msg, "tx");
    } finally {
      if (identityRequestRef.current === clearRequest) {
        setIsSealingId(false);
        setIdentityAction("");
      }
    }
  }, [
    appendLog,
    account,
    chainAligned,
    contractAddress,
    contractReady,
    expectedTreasuryConfigured,
    network,
    walletContractScope,
  ]);

  /* --------------------------------- render --------------------------------- */

  // Onboarding hint that types itself out below the title.
  const greeting = useTypewriter(
    "$ connect wallet → pick network → add contract → post",
    14,
  );

  const txHref = lastTx ? `${network.explorer}/tx/${lastTx}` : "";
  const composingLine = answeringTo ?? echoingTo;
  const composingMode = answeringTo ? "answering" : "echoing";
  const profileWatchWarningCount = sigcardViews.filter(
    (card) => card.profileWatch?.tone === "warn",
  ).length;
  const profilePinWarningCount = sigcardViews.filter(
    (card) => card.profilePinStatus.changed,
  ).length;

  return (
    <div className="deck">
      <FiberBackdrop />

      {/* ------------------------------- TOP BAR ------------------------------ */}
      <header className="topbar" role="banner">
        <a className="brand" href="#deck" aria-label="Sigline home">
          <Terminal size={14} aria-hidden="true" />
          <span className="brand__name">BASE</span>
          <span className="brand__dot">·</span>
          <span className="brand__sub">SIGLINE</span>
          <span className="brand__rev">v0.1</span>
        </a>

        <nav className="topnav" aria-label="Primary">
          <a href="#receive">
            <Radio size={12} aria-hidden="true" />
            feed
          </a>
          <a href="#transmit">
            <Send size={12} aria-hidden="true" />
            transmit
          </a>
          <a href="#rig">
            <Cpu size={12} aria-hidden="true" />
            rig
          </a>
          <a href="#trust">
            <ShieldCheck size={12} aria-hidden="true" />
            trust
          </a>
        </nav>

        <div className="topbar__hud">
          <span className="hud-chip">
            <StatusDot tone={telemetry.online ? "good" : "warn"} pulse />
            <span>{network.short}</span>
          </span>
          <span className="hud-chip">
            <span className="hud-chip__k">blk</span>
            <span className="hud-chip__v">
              {telemetry.blockNumber !== null
                ? `#${telemetry.blockNumber}`
                : "—"}
            </span>
          </span>
          <span className="hud-chip">
            <span className="hud-chip__k">gas</span>
            <span className="hud-chip__v">
              {telemetry.gasGwei !== null
                ? `${telemetry.gasGwei.toFixed(3)} gwei`
                : "—"}
            </span>
          </span>
          <button
            type="button"
            className={[
              "wallet-pill",
              account ? "wallet-pill--on" : "",
              walletBusy ? "wallet-pill--busy" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={connectWallet}
            aria-label={
              walletBusy
                ? "Transaction in progress"
                : account
                  ? "Wallet connected"
                  : "Connect wallet"
            }
            aria-busy={walletBusy || undefined}
          >
            <Wallet size={13} aria-hidden="true" />
            {account ? (
              <>
                <StatusDot
                  tone={walletBusy ? "warn" : chainAligned ? "good" : "warn"}
                  pulse
                />
                <span>{walletBusy ? "signing…" : shorten(account)}</span>
              </>
            ) : (
              <>
                <StatusDot tone="warn" />
                <span>connect</span>
              </>
            )}
          </button>
        </div>
      </header>

      <main id="deck" className="deck__main">
        {/* ---------------------------- INTRO -------------------------------- */}
        <section className="cmd" aria-label="Sigline intro">
          <pre className="cmd__ascii" aria-hidden="true">
            {ASCII_TITLE}
          </pre>

          <div className="cmd__meta">
            <span>[ build ░ v0.1 ]</span>
            <span>[ network ░ {network.short} ]</span>
            <span>
              [ contract ░{" "}
              {contractAddress ? shortHash(contractAddress) : "not set"} ]
            </span>
            <span>[ wallet ░ {account ? "connected" : "not connected"} ]</span>
          </div>

          <h1 className="cmd__h1">
            <span>A small public feed, signed on Base.</span>
          </h1>

          <p className="cmd__lede">
            Post short messages to a Base smart contract. Anyone can read them.
            Events carry the line text; contract storage keeps compact hash
            pointers for verification.
          </p>

          <div className="cmd__motto" aria-hidden="true">
            <span>&gt; </span>
            {greeting}
            <BootCursor />
          </div>

          <div className="cmd__strip" role="group" aria-label="Chain telemetry">
            <TelemetryTile
              icon={<Satellite size={13} />}
              k="net"
              v={network.label}
              sub={`id ${network.chainId.toString()}`}
              tone={telemetry.online ? "good" : "warn"}
            />
            <TelemetryTile
              icon={<Activity size={13} />}
              k="block"
              v={
                telemetry.blockNumber !== null
                  ? `#${telemetry.blockNumber.toLocaleString()}`
                  : "—"
              }
              sub={
                telemetry.rttMs !== null ? `rtt ${telemetry.rttMs}ms` : "rtt —"
              }
              tone={telemetry.online ? "good" : "idle"}
            />
            <TelemetryTile
              icon={<Zap size={13} />}
              k="gas"
              v={
                telemetry.gasGwei !== null
                  ? `${telemetry.gasGwei.toFixed(3)} gwei`
                  : "—"
              }
              sub={telemetry.gasGwei !== null ? "base fee" : "no quote"}
              tone={
                telemetry.gasGwei === null
                  ? "idle"
                  : telemetry.gasGwei > 5
                    ? "warn"
                    : "good"
              }
            />
            <TelemetryTile
              icon={<Signal size={13} />}
              k="rpc"
              v={shortRpc(rpcUrl || network.rpcUrl)}
              sub={telemetry.online ? "online" : "stale"}
              tone={telemetry.online ? "good" : "bad"}
            />
            <TelemetryTile
              icon={<Power size={13} />}
              k="wallet"
              v={account ? shorten(account) : "offline"}
              sub={
                account ? (chainAligned ? "aligned" : "wrong chain") : "no wallet"
              }
              tone={account ? (chainAligned ? "good" : "warn") : "idle"}
            />
          </div>
        </section>

        {/* ----------------------------- FEED -------------------------------- */}
        <section id="receive" className="receive">
          <Panel
            label="FEED"
            meta="Read posts from the contract"
            tone={
              isLoading
                ? "warn"
                  : feedError
                    ? "bad"
                  : !isPreviewTimeline && shownTimeline.length > 0
                    ? "good"
                    : "idle"
            }
            pending={isLoading}
            flashKey={scanFlash}
            actions={
              <span className="receive__count">
                {feedError
                  ? "error"
                  : isPreviewTimeline
                    ? "sample"
                    : `${timeline.length} loaded`}
              </span>
            }
          >
            {readerControlsOpen ? (
              <div className="receive__bar">
                <Field label="feed scope" hint="Choose who to scan">
                    <Select
                      value={scanScope}
                      onChange={(event) => {
                        resetFeedResults();
                        setScanScope(event.target.value as ScanScope);
                      }}
                    >
                    <option value="all">everyone</option>
                    <option value="tracked">tracked only</option>
                    <option value="address">one address</option>
                  </Select>
                </Field>
                <Field
                  label="wallet address"
                  hint={
                    scanScope === "address"
                      ? "Scan this wallet"
                      : "Optional — track a wallet here"
                  }
                  optional
                >
                  <Input
                      value={targetAddress}
                      placeholder="0x… (optional)"
                      onChange={(event) => {
                        resetFeedResults();
                        setTargetAddress(event.target.value);
                      }}
                    />
                </Field>
                <Field label="start block" hint="First block to scan for posts">
                  <Input
                      value={fromBlock}
                      onChange={(event) => {
                        resetFeedResults();
                        setFromBlock(event.target.value);
                      }}
                    inputMode="numeric"
                    placeholder="0"
                  />
                </Field>
                <Field
                  label="proof rpc"
                  hint="Second endpoint for independent proof"
                  optional
                >
                  <Input
                    value={proofRpcUrl}
                    placeholder="https://..."
                    onChange={(event) => setProofRpcUrl(event.target.value)}
                  />
                </Field>
                <div className="receive__bar-actions">
                  <Button
                    variant="ghost"
                    icon={<Fingerprint size={14} />}
                    onClick={() => trackSigner(targetAddress)}
                    disabled={!isAddressLike(targetAddress)}
                  >
                    track address
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setReaderControlsOpen(false)}
                  >
                    hide controls
                  </Button>
                  <Button
                    variant="ghost"
                    icon={<RefreshCw size={14} />}
                    onClick={() =>
                      loadTimeline({ endBlock: olderScanBlock, older: true })
                    }
                    loading={isLoading}
                    disabled={!canScanOlder}
                  >
                    scan older
                  </Button>
                  <Button
                    variant="ghost"
                    icon={<RefreshCw size={14} />}
                    onClick={() =>
                      loadTimeline({ startBlock: nextScanBlock, merge: true })
                    }
                    loading={isLoading}
                    disabled={!canScanNewer}
                  >
                    scan newer
                  </Button>
                  <Button
                    variant="primary"
                    icon={<Radio size={14} />}
                    onClick={() => loadTimeline()}
                    loading={isLoading}
                    disabled={!contractReady}
                  >
                    {isLoading ? "scanning…" : "scan"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="receive__compact" aria-label="Scan controls">
                <span>
                  {scanScope === "all"
                    ? "everyone"
                    : scanScope === "tracked"
                      ? selectedCircleData
                        ? `${selectedCircleData.name} · ${trackedScanSigners.length}`
                        : `${trackedSigners.length} tracked`
                      : targetAddress
                        ? shorten(targetAddress)
                        : "one address"}{" "}
                  · from #{fromBlock || "0"}
                </span>
                <Button variant="ghost" onClick={() => setReaderControlsOpen(true)}>
                  show controls
                </Button>
                <Button
                  variant="ghost"
                  icon={<RefreshCw size={14} />}
                  onClick={() =>
                    loadTimeline({ endBlock: olderScanBlock, older: true })
                  }
                  loading={isLoading}
                  disabled={!canScanOlder}
                >
                  scan older
                </Button>
                <Button
                  variant="ghost"
                  icon={<RefreshCw size={14} />}
                  onClick={() =>
                    loadTimeline({ startBlock: nextScanBlock, merge: true })
                  }
                  loading={isLoading}
                  disabled={!canScanNewer}
                >
                  scan newer
                </Button>
                <Button
                  variant="primary"
                  icon={<Radio size={14} />}
                  onClick={() => loadTimeline()}
                  loading={isLoading}
                  disabled={!contractReady}
                >
                  {isLoading ? "scanning…" : "scan"}
                </Button>
              </div>
            )}

            {feedProvenanceSummary ? (
              <div className="feed-provenance" aria-label="Feed provenance">
                <span>
                  <strong>source</strong>
                  {feedProvenanceSummary.source}
                </span>
                <span>
                  <strong>window</strong>
                  {feedProvenanceSummary.window}
                </span>
                <span>
                  <strong>rpc</strong>
                  {feedProvenanceSummary.rpc}
                </span>
                <span>
                  <strong>scope</strong>
                  {feedProvenanceSummary.scope}
                </span>
                <span>
                  <strong>rows</strong>
                  {feedProvenanceSummary.loaded}
                </span>
                <span>
                  <strong>loaded</strong>
                  {feedProvenanceSummary.age}
                </span>
              </div>
            ) : null}

            <div className="reader-tools" aria-label="Reader filters">
              <Field label="find" hint="Search loaded text, wallet, tx, or hash">
                <Input
                  value={feedQuery}
                  placeholder="text, 0x, tx..."
                  onChange={(event) => setFeedQuery(event.target.value)}
                />
              </Field>
              <div className="reader-tools__modes" role="group" aria-label="Feed mode">
                {(
                  [
                    ["all", "all"],
                    ["unread", "unread"],
                    ["mentions", "mentions"],
                    ["media", "media"],
                    ["refs", "refs"],
                    ["saved", "saved"],
                    ["marked", "marked"],
                    ["highlighted", "hot"],
                    ["flagged", "flagged"],
                    ["checked", "checked"],
                    ["needs-check", "needs check"],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    type="button"
                    key={mode}
                    className={[
                      "reader-tools__mode",
                      feedMode === mode ? "reader-tools__mode--active" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => setFeedMode(mode)}
                    aria-pressed={feedMode === mode}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <Field label="sort" hint="Order loaded rows">
                <Select
                  value={feedSort}
                  onChange={(event) => setFeedSort(event.target.value as FeedSort)}
                >
                  <option value="newest">newest first</option>
                  <option value="oldest">oldest first</option>
                </Select>
              </Field>
              <span className="reader-tools__count">
                {feedRows.length}/{visibleTimeline.length} visible
              </span>
              <div className="reader-tools__actions">
                <Button
                  variant="ghost"
                  icon={<ShieldCheck size={14} />}
                  onClick={verifyVisibleFeed}
                  loading={isVerifyingFeed}
                  disabled={
                    !contractReady || isLoading || verifiableFeedRows.length === 0
                  }
                >
                  check visible
                </Button>
                <Button
                  variant="ghost"
                  icon={<BadgeCheck size={14} />}
                  onClick={proveVisibleFeed}
                  loading={isProofingFeed}
                  disabled={
                    !contractReady ||
                    isPreviewTimeline ||
                    isLoading ||
                    verifiableFeedRows.length === 0 ||
                    !proofRpcUrl.trim()
                  }
                >
                  2-rpc proof
                </Button>
                <Button
                  variant="ghost"
                  icon={<CheckCheck size={14} />}
                  onClick={markVisibleRead}
                  disabled={
                    isPreviewTimeline ||
                    feedRows.filter((item) => !isSampleItem(item)).length === 0
                  }
                >
                  mark read
                </Button>
                <Button
                  variant="ghost"
                  icon={<Copy size={14} />}
                  onClick={copyPublicReaderLink}
                  disabled={!contractReady}
                >
                  copy link
                </Button>
                <Button
                  variant="ghost"
                  icon={<Download size={14} />}
                  onClick={openFeedBundleImport}
                  disabled={!contractReady}
                >
                  {bundleImportOpen ? "hide import" : "import bundle"}
                </Button>
                <Button
                  variant="ghost"
                  icon={<Copy size={14} />}
                  onClick={copyVisibleDigest}
                  disabled={
                    isPreviewTimeline ||
                    feedRows.length === 0 ||
                    hasUncheckedVisibleLines
                  }
                  title={
                    hasUncheckedVisibleLines
                      ? "Verify visible lines before copying a digest."
                      : undefined
                  }
                >
                  copy digest
                </Button>
                <Button
                  variant="ghost"
                  icon={<Copy size={14} />}
                  onClick={copyVisibleFeed}
                  disabled={
                    isPreviewTimeline ||
                    feedRows.length === 0 ||
                    hasUncheckedVisibleLines
                  }
                  title={
                    hasUncheckedVisibleLines
                      ? "Verify visible lines before copying a feed bundle."
                      : undefined
                  }
                >
                  {account ? "copy signed bundle" : "copy bundle"}
                </Button>
                {hasActiveFeedFilter ? (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setFeedQuery("");
                      setFeedMode("all");
                      setSelectedChannel("");
                      setSelectedCircle("");
                    }}
                  >
                    clear
                  </Button>
                ) : null}
              </div>
            </div>

            {bundleImportOpen ? (
              <div className="bundle-import" aria-label="Feed bundle import">
                <form
                  className="bundle-import__form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    previewFeedBundleImport();
                  }}
                >
                  <Field
                    label="bundle JSON"
                    hint="Paste a feed bundle or follow pack. Importing tracks wallets only."
                    error={bundleImportError || undefined}
                  >
                    <Textarea
                      value={bundleImportText}
                      onChange={(event) => {
                        setBundleImportText(event.target.value);
                        setBundleImportPreview(null);
                        setBundleImportError("");
                      }}
                      placeholder='{"schema":"sigline.feed.v1",...}'
                    />
                  </Field>
                  <div className="bundle-import__actions">
                    <Button type="submit" variant="tonal" icon={<ShieldCheck size={14} />}>
                      preview
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      icon={<Fingerprint size={14} />}
                      onClick={applyFeedBundleImport}
                      disabled={!bundleImportPreview}
                    >
                      track wallets
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      icon={<Users size={14} />}
                      onClick={applyFeedBundleImportToCircle}
                      disabled={!bundleImportPreview || !selectedCircleData}
                      title={
                        selectedCircleData
                          ? `Track wallets and add them to ${selectedCircleData.name}.`
                          : "Select a local circle before importing into a circle."
                      }
                    >
                      add to circle
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={clearFeedBundleImport}
                      disabled={!bundleImportText && !bundleImportPreview}
                    >
                      clear import
                    </Button>
                  </div>
                </form>
                {bundleImportPreview ? (
                  <div className="bundle-import__preview" role="status">
                    <span>
                      <strong>source</strong>
                      {bundleImportSourceLabel(bundleImportPreview.result)}
                    </span>
                    <span>
                      <strong>wallets</strong>
                      {bundleImportNewAuthors.length} new /{" "}
                      {bundleImportPreview.result.authors.length} total
                    </span>
                    <span>
                      <strong>signature</strong>
                      {bundleImportSignatureLabel(bundleImportPreview.result)}
                    </span>
                    <span>
                      <strong>scope</strong>
                      {bundleImportPreview.result.context?.network ?? networkKey} ·{" "}
                      {bundleImportPreview.result.context?.chainId ??
                        network.chainId.toString()}
                    </span>
                    <span className="bundle-import__wide">
                      <strong>contract</strong>
                      {bundleImportPreview.result.context?.contract ?? contractAddress}
                    </span>
                    <span className="bundle-import__wide">
                      <strong>new wallets</strong>
                      {bundleImportNewAuthors.length
                        ? bundleImportNewAuthors.join(" ")
                        : "none"}
                    </span>
                    {selectedCircleData ? (
                      <span className="bundle-import__wide">
                        <strong>circle</strong>
                        {selectedCircleData.name} ·{" "}
                        {bundleImportCircleNewAuthors.length
                          ? `${bundleImportCircleNewAuthors.length} new wallet${bundleImportCircleNewAuthors.length === 1 ? "" : "s"}`
                          : "already has these wallets"}
                      </span>
                    ) : null}
                    <span className="bundle-import__wide">
                      <strong>effect</strong>
                      Tracks wallets locally. Circle import also updates the selected
                      local circle. Imported posts are not rendered or trusted.
                    </span>
                    {bundleImportPreview.result.warnings.length ? (
                      <span className="bundle-import__wide bundle-import__warn">
                        <strong>warnings</strong>
                        {bundleImportPreview.result.warnings.join(" ")}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="reader-sources" aria-label="Public reader sources">
              <form
                className="reader-sources__save"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveReaderSource(readerSourceNameInput);
                }}
              >
                <Field
                  label="source"
                  hint="Save public scan context only"
                  optional
                >
                  <Input
                    value={readerSourceNameInput}
                    onChange={(event) =>
                      setReaderSourceNameInput(event.target.value)
                    }
                    placeholder="e.g. base media"
                    maxLength={MAX_READER_SOURCE_NAME_BYTES}
                  />
                </Field>
                <Button
                  type="submit"
                  variant="ghost"
                  disabled={!contractReady || !readerSourceNameInput.trim()}
                >
                  save source
                </Button>
              </form>
              <div className="reader-sources__strip">
                <span className="reader-sources__label">
                  sources {readerSources.length}
                </span>
                {readerSources.length ? (
                  readerSources.map((source) => (
                    <span className="reader-source-pill" key={source.id}>
                      <button
                        type="button"
                        onClick={() => applyReaderSource(source)}
                        title={readerSourceSummary(source)}
                      >
                        {source.name}
                      </button>
                      <button
                        type="button"
                        className="reader-source-pill__delete"
                        onClick={() => removeReaderSource(source)}
                        title="Delete this public reader source"
                      >
                        ×
                      </button>
                    </span>
                  ))
                ) : (
                  <span className="reader-sources__empty">
                    Save public scan shortcuts.
                  </span>
                )}
              </div>
            </div>

            <div className="reader-lenses" aria-label="Private reader lenses">
              <form
                className="reader-lenses__save"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveReaderLens(readerLensNameInput);
                }}
              >
                <Field
                  label="lens"
                  hint="Save the current reader filters locally"
                  optional
                >
                  <Input
                    value={readerLensNameInput}
                    onChange={(event) =>
                      setReaderLensNameInput(event.target.value)
                    }
                    placeholder="e.g. checked builders"
                    maxLength={MAX_READER_LENS_NAME_BYTES}
                  />
                </Field>
                <Button
                  type="submit"
                  variant="ghost"
                  disabled={!readerLensScope || !readerLensNameInput.trim()}
                >
                  save lens
                </Button>
              </form>
              <div className="reader-lenses__strip">
                <span className="reader-lenses__label">
                  lenses {readerLenses.length}
                </span>
                {readerLenses.length ? (
                  readerLenses.map((lens) => (
                    <span className="reader-lens-pill" key={lens.id}>
                      <button
                        type="button"
                        onClick={() => applyReaderLens(lens)}
                        title="Apply this private reader lens"
                      >
                        {lens.name}
                      </button>
                      <button
                        type="button"
                        className="reader-lens-pill__delete"
                        onClick={() => removeReaderLens(lens)}
                        title="Delete this private reader lens"
                      >
                        ×
                      </button>
                    </span>
                  ))
                ) : (
                  <span className="reader-lenses__empty">
                    Save private views for this contract.
                  </span>
                )}
              </div>
            </div>

            <div className="feed-stats" aria-label="Visible feed stats">
              <span>
                <strong>{feedStats.lines}</strong> lines
              </span>
              <span>
                <strong>{feedStats.wallets}</strong> wallets
              </span>
              <span>
                <strong>{feedStats.media}</strong> media
              </span>
              <span>
                <strong>{feedStats.refs}</strong> refs
              </span>
              <span>
                <strong>{feedStats.unread}</strong> unread
              </span>
              <span>
                <strong>{mentionStats.count}</strong> mentions
              </span>
              <span>
                <strong>{feedStats.saved}</strong> saved
              </span>
              <span>
                <strong>{markedVisibleLineCount}</strong> marked
              </span>
              <span>
                <strong>{highlightedVisibleLineCount}</strong> hot
              </span>
              <span>
                <strong>{flaggedVisibleLineCount}</strong> flagged
              </span>
              <span>
                <strong>{trustedVisibleLineCount}</strong> checked
              </span>
              <span>
                <strong>{uncheckedVisibleLineCount}</strong> needs check
              </span>
            </div>

            <div className="channel-strip" aria-label="Local channels">
              <span className="channel-strip__label">
                channels
                {activeChannel ? ` · ${channelLabel(activeChannel)}` : ""}
              </span>
              {channelStats.length ? (
                channelStats.map((channel) => (
                  <span
                    className={[
                      "channel-pill",
                      channel.id === activeChannel ? "channel-pill--active" : "",
                      channel.pinned ? "channel-pill--pinned" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    key={channel.id}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedChannel((current) =>
                          current === channel.id ? "" : channel.id,
                        )
                      }
                      title="Filter loaded lines by this local channel"
                    >
                      {channel.label} · {channel.count}
                      {channel.unread ? ` · ${channel.unread} unread` : ""}
                    </button>
                    <button
                      type="button"
                      className="channel-pill__pin"
                      onClick={() => togglePinnedChannel(channel.id)}
                      title={
                        channel.pinned
                          ? "Unpin this local channel"
                          : "Pin this local channel for this contract"
                      }
                    >
                      {channel.pinned ? "×" : "pin"}
                    </button>
                    <button
                      type="button"
                      className="channel-pill__link"
                      onClick={() => copyPublicChannelLink(channel.id)}
                      disabled={!contractReady}
                      title="Copy a public feed link for this channel"
                    >
                      link
                    </button>
                  </span>
                ))
              ) : (
                <span className="channel-strip__empty">
                  Local #topic and $ASSET channels appear from loaded lines.
                </span>
              )}
              {activeChannel ? (
                <button
                  type="button"
                  className="channel-strip__clear"
                  onClick={() => setSelectedChannel("")}
                >
                  clear channel
                </button>
              ) : null}
            </div>

            <div className="mention-strip" aria-label="Local mentions lens">
              <span className="mention-strip__label">
                <AtSign size={13} aria-hidden="true" />
                mentions
                {mentionTarget
                  ? account
                    ? " · me"
                    : " · target"
                  : ""}
              </span>
              {mentionTarget ? (
                <>
                  <button
                    type="button"
                    className={[
                      "mention-pill",
                      feedMode === "mentions" ? "mention-pill--active" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() =>
                      setFeedMode((current) =>
                        current === "mentions" ? "all" : "mentions",
                      )
                    }
                    title="Filter loaded lines that mention this address or current alias"
                  >
                    {shorten(mentionTarget.address)} · {mentionStats.count}
                    {mentionStats.unread ? ` · ${mentionStats.unread} unread` : ""}
                  </button>
                  {mentionTarget.aliases.length ? (
                    <span className="mention-strip__alias">
                      alias now @{mentionTarget.aliases.join(", @")}
                    </span>
                  ) : (
                    <span className="mention-strip__alias">
                      address mentions only
                    </span>
                  )}
                </>
              ) : (
                <span className="mention-strip__empty">
                  Connect a wallet or enter an address to resolve local mentions.
                </span>
              )}
            </div>

            <div className="circle-strip" aria-label="Local circles">
              <span className="circle-strip__label">
                <Users size={13} aria-hidden="true" />
                circles {circles.length}
                {selectedCircleData ? ` · ${selectedCircleData.name}` : ""}
              </span>
              <Input
                className="input circle-strip__input"
                value={circleNameInput}
                placeholder="new circle"
                aria-label="New local circle name"
                onChange={(event) => setCircleNameInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") createCircle();
                }}
              />
              <Button
                variant="ghost"
                onClick={createCircle}
                disabled={!circleNameInput.trim()}
              >
                create
              </Button>
              {circleStats.length ? (
                circleStats.map((circle) => (
                  <span
                    className={[
                      "circle-pill",
                      circle.id === activeCircle ? "circle-pill--active" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    key={circle.id}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedCircle((current) =>
                          current === circle.id ? "" : circle.id,
                        )
                      }
                      title="Filter loaded lines and tracked scans to this local circle"
                    >
                      {circle.name} · {circle.addresses.length}
                      {circle.visibleCount ? ` · ${circle.visibleCount} lines` : ""}
                      {circle.unread ? ` · ${circle.unread} unread` : ""}
                    </button>
                  </span>
                ))
              ) : (
                <span className="circle-strip__empty">
                  Local follow lists stay in this browser.
                </span>
              )}
              {selectedCircleData ? (
                <>
                  <button
                    type="button"
                    className="circle-strip__action"
                    onClick={() => toggleSelectedCircleMember(targetAddress)}
                    disabled={!isAddressLike(targetAddress)}
                    title="Add or remove the author filter address from this circle"
                  >
                    {selectedCircleMembers.has(targetAddress.toLowerCase())
                      ? "remove target"
                      : "add target"}
                  </button>
                  <button
                    type="button"
                    className="circle-strip__action"
                    onClick={copyCircleFollowPack}
                    disabled={
                      !contractReady ||
                      !selectedCircleData.addresses.length ||
                      selectedCircleData.addresses.length >
                        MAX_FEED_BUNDLE_IMPORT_AUTHORS
                    }
                    title={
                      !contractReady
                        ? "Set a valid contract address before copying a circle follow pack"
                        : selectedCircleData.addresses.length >
                      MAX_FEED_BUNDLE_IMPORT_AUTHORS
                        ? `Follow packs can include at most ${MAX_FEED_BUNDLE_IMPORT_AUTHORS} wallets.`
                        : "Copy this circle as a public follow pack"
                    }
                  >
                    copy circle pack
                  </button>
                  <button
                    type="button"
                    className="circle-strip__action"
                    onClick={() => setSelectedCircle("")}
                  >
                    clear circle
                  </button>
                  <button
                    type="button"
                    className="circle-strip__action circle-strip__action--warn"
                    onClick={removeSelectedCircle}
                  >
                    delete circle
                  </button>
                </>
              ) : null}
            </div>

            <div className="tracked-strip" aria-label="Tracked wallets">
              <span className="tracked-strip__label">
                tracking {trackedSigners.length}
              </span>
              {trackedSigners.length ? (
                <button
                  type="button"
                  className="tracked-pill tracked-pill--action"
                  onClick={copyFollowPack}
                  disabled={!contractReady}
                  title={
                    contractReady
                      ? "Copy tracked wallets as a local follow pack"
                      : "Set a valid contract address before copying a follow pack"
                  }
                >
                  {account ? "copy signed follow pack" : "copy follow pack"}
                </button>
              ) : null}
              {trackedSigners.length ? (
                trackedSigners.map((signer) => (
                  <button
                    type="button"
                    className="tracked-pill"
                    key={signer}
                    onClick={() => forgetSigner(signer)}
                    title="Stop tracking wallet"
                  >
                    {shorten(signer)} ×
                  </button>
                ))
              ) : (
                <span className="tracked-strip__empty">
                  Track wallets from the feed or by address.
                </span>
              )}
            </div>

            {feedError ? (
              <EmptyState title="Scan failed" hint={feedError} />
            ) : null}

            {!feedError && isPreviewTimeline ? (
              <p className="receive__note">
                Showing sample posts. Set a contract address, choose a start
                block, then press <kbd>scan</kbd> to load real posts.
              </p>
            ) : null}

            {!feedError &&
            visibleTimeline.length > 0 &&
            feedRows.length === 0 ? (
              <EmptyState
                title="No matching posts"
                hint="Clear the reader filters or try a broader search."
              />
            ) : null}

            {!feedError && !isPreviewTimeline && visibleTimeline.length === 0 ? (
              <EmptyState
                title={timeline.length ? "No posts visible" : "No posts found"}
                hint={
                  timeline.length
                    ? "Muted wallets or text are hidden. Show muted lines or remove a local mute to restore them."
                    : "Try lowering the start block, removing the author filter, or double-checking the contract address."
                }
              />
            ) : null}

            <div className="feed" role="list">
              {isLoading
                ? Array.from({ length: 3 }).map((_, i) => (
                    <FeedSkeleton key={i} />
                  ))
                : feedRows.map((item) => {
                    const itemKey = item.contentHash.toLowerCase();
                    const cachedRecord = savedLineCache[itemKey];
                    const cachedProof =
                      cachedRecord &&
                      savedLineScopeMatches(cachedRecord, networkKey, contractAddress)
                        ? cachedRecord.proof
                        : undefined;
                    const sameRpcAudit =
                      lineAudits[lineAuditKey(item)] ??
                      savedProofStatusToAudit(cachedProof?.sameRpc);
                    const independentAudit =
                      proofAudits[proofAuditKey(item)] ??
                      savedProofStatusToAudit(cachedProof?.independent);
                    const rowImageAudit =
                      imageAudits[imageAuditKey(item)] ??
                      savedProofStatusToAudit(cachedProof?.image);
                    const isTrusted = lineTrustSnapshot(item).trusted;
                    const isSignerMuted = mutedSet.has(item.author.toLowerCase());
                    const isTermMuted = itemMatchesMutedTerms(item);
                    return (
                      <FeedRow
                        key={item.id}
                        item={item}
                        explorer={network.explorer}
                        authorNick={
                          sigcards[item.author.toLowerCase()]?.nick.trim() ?? ""
                        }
                        authorLabel={walletLabelFor(item.author)}
                        authorFlag={walletFlagFor(item.author)}
                        lineMark={lineMarkForHash(item.contentHash)}
                        lineNote={lineNoteForHash(item.contentHash)}
                        highlightTerms={highlightedTermsForLine(item)}
                        isTracked={trackedSet.has(item.author.toLowerCase())}
                        isMuted={isSignerMuted}
                        isFiltered={isSignerMuted || isTermMuted}
                        activeCircleName={selectedCircleData?.name ?? ""}
                        isInActiveCircle={selectedCircleMembers.has(
                          item.author.toLowerCase(),
                        )}
                        isRead={readSet.has(itemKey)}
                        isSaved={savedSet.has(itemKey)}
                        isFocused={
                          Boolean(permalinkLineHash) &&
                          item.contentHash.toLowerCase() === permalinkLineHash
                        }
                        isEditingNote={
                          editingNoteHash === item.contentHash.toLowerCase()
                        }
                        noteDraft={noteDraft}
                        audit={sameRpcAudit}
                        proofAudit={independentAudit}
                        imageAudit={rowImageAudit}
                        verifiedImageUrl={verifiedImageUrls[imageAuditKey(item)]}
                        canVerify={!item.id.startsWith("sample-")}
                        isTrusted={isTrusted}
                        referencedLine={
                          item.refHash !== ZERO_HASH
                            ? lineByHash.get(item.refHash.toLowerCase())
                            : undefined
                        }
                        threadChildren={threadChildrenByHash.get(
                          item.contentHash.toLowerCase(),
                        )}
                        isThreadLoading={
                          threadLoadingHash === item.contentHash.toLowerCase()
                        }
                        isThreadLoaded={Boolean(threadLoadedHashes[itemKey])}
                        referencedAuthorNick={
                          item.refHash !== ZERO_HASH
                            ? sigcards[
                                lineByHash
                                  .get(item.refHash.toLowerCase())
                                  ?.author.toLowerCase() ?? ""
                              ]?.nick.trim() ?? ""
                            : ""
                        }
                        referencedAuthorLabel={
                          item.refHash !== ZERO_HASH
                            ? walletLabelFor(
                                lineByHash.get(item.refHash.toLowerCase())
                                  ?.author ?? "",
                              )
                            : ""
                        }
                        referencedAuthorFlag={
                          item.refHash !== ZERO_HASH
                            ? walletFlagFor(
                                lineByHash.get(item.refHash.toLowerCase())
                                  ?.author ?? "",
                              )
                            : ""
                        }
                        referencedLineNote={
                          item.refHash !== ZERO_HASH
                            ? lineNoteForHash(
                                lineByHash.get(item.refHash.toLowerCase())
                                  ?.contentHash ?? "",
                              )
                            : ""
                        }
                        referencedLineMark={
                          item.refHash !== ZERO_HASH
                            ? lineMarkForHash(
                                lineByHash.get(item.refHash.toLowerCase())
                                  ?.contentHash ?? "",
                              )
                            : ""
                        }
                        onTrack={trackSigner}
                        onForget={forgetSigner}
                        onLabel={stageWalletLabel}
                        onToggleWalletFlag={toggleWalletFlag}
                        onEditNote={stageLineNote}
                        onChangeNote={setNoteDraft}
                        onSaveNote={saveLineNote}
                        onClearNote={clearLineNote}
                        onCancelNote={() => {
                          setEditingNoteHash("");
                          setNoteDraft("");
                        }}
                        onToggleMark={toggleLineMark}
                        onToggleCircle={toggleSelectedCircleMember}
                        onMute={muteSigner}
                        onUnmute={unmuteSigner}
                        onToggleRead={toggleReadLine}
                        onSave={toggleSavedLine}
                        onShare={shareLine}
                        onShareThread={shareThread}
                        onCopyAuthorFeed={copyAuthorFeedLink}
                        onCopyBundle={copyLineBundle}
                        onVerify={verifyLinePointer}
                        onVerifyImage={verifyImageHash}
                        onAnswer={answerLine}
                        onEcho={echoLine}
                        onLoadThread={loadLineThread}
                      />
                    );
                  })}
            </div>
          </Panel>
        </section>

        {/* ---------------------------- SIGCARDS ----------------------------- */}
        <section id="sigcards" className="sigcards">
          <Panel
            label="SIGCARDS"
            meta="Wallet aliases and visible activity"
            tone={
              isLoadingSigcards
                ? "warn"
                : profileWatchWarningCount || profilePinWarningCount
                  ? "warn"
                : sigcardViews.length > 0
                  ? "good"
                  : "idle"
            }
            pending={isLoadingSigcards}
            actions={
              <span className="sigcards__count">
                {sigcardViews.length} wallet{sigcardViews.length === 1 ? "" : "s"}
                {Object.keys(walletLabels).length
                  ? ` · ${Object.keys(walletLabels).length} private label${
                      Object.keys(walletLabels).length === 1 ? "" : "s"
                    }`
                  : ""}
                {Object.keys(walletFlags).length
                  ? ` · ${Object.keys(walletFlags).length} private flag${
                      Object.keys(walletFlags).length === 1 ? "" : "s"
                    }`
                  : ""}
                {profileWatchWarningCount
                  ? ` · ${profileWatchWarningCount} profile watch`
                  : ""}
                {Object.keys(profilePins).length
                  ? ` · ${Object.keys(profilePins).length} profile pin${
                      Object.keys(profilePins).length === 1 ? "" : "s"
                    }`
                  : ""}
                {profilePinWarningCount
                  ? ` · ${profilePinWarningCount} pin warning${
                      profilePinWarningCount === 1 ? "" : "s"
                    }`
                  : ""}
              </span>
            }
          >
            <form
              id="wallet-label-editor"
              className="wallet-labels"
              onSubmit={(event) => {
                event.preventDefault();
                saveWalletLabel(labelAddressInput, labelTextInput);
              }}
            >
              <Field
                label="local label wallet"
                hint="Private to this browser; not a sigcard or identity proof."
              >
                <Input
                  value={labelAddressInput}
                  onChange={(event) => setLabelAddressInput(event.target.value)}
                  placeholder="0x..."
                />
              </Field>
              <Field
                label="private label"
                hint={`${MAX_WALLET_LABEL_BYTES} UTF-8 bytes max`}
              >
                <Input
                  value={labelTextInput}
                  onChange={(event) => setLabelTextInput(event.target.value)}
                  placeholder="e.g. base builder"
                />
              </Field>
              <div className="wallet-labels__actions">
                <Button type="submit" variant="tonal">
                  save label
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => clearWalletLabel(labelAddressInput)}
                >
                  clear
                </Button>
              </div>
            </form>
            {sigcardViews.length ? (
              <div className="sigcard-list">
                {sigcardViews.map((card) => (
                  <SigcardRow
                    key={card.address}
                    card={card}
                    explorer={network.explorer}
                    isTracked={trackedSet.has(card.address.toLowerCase())}
                    activeCircleName={selectedCircleData?.name ?? ""}
                    isInActiveCircle={selectedCircleMembers.has(
                      card.address.toLowerCase(),
                    )}
                    onTrack={trackSigner}
                    onForget={forgetSigner}
                    onLabel={stageWalletLabel}
                    onToggleWalletFlag={toggleWalletFlag}
                    onPinProfile={pinSigcardProfile}
                    onClearProfilePin={clearSigcardProfilePin}
                    onToggleCircle={toggleSelectedCircleMember}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                title="No wallets visible"
                hint="Scan the feed or track an address to build a sigcard roster."
              />
            )}
          </Panel>
        </section>

        {/* ----------------------------- SAFETY ------------------------------ */}
        <section id="safety" className="safety">
          <Panel
            label="SAFETY"
            meta="Local-only mute and highlight controls"
            tone={
              mutedSigners.length || mutedTerms.length
                ? "warn"
                : highlightedTerms.length
                  ? "good"
                  : "good"
            }
            actions={
              <Button
                variant={showMuted ? "tonal" : "ghost"}
                onClick={() => setShowMuted((current) => !current)}
              >
                {showMuted ? "hide muted" : "show muted"}
              </Button>
            }
          >
            <div className="safety__body">
              <p>
                Muting hides matching lines locally. Highlighting keeps lines
                visible and marks them for faster scanning.
              </p>
              <div className="row row--2">
                <Field
                  label="image checks"
                  hint={
                    imageGatewayMode === "fallbacks"
                      ? "Image verification may try public fallback gateways."
                      : "Image verification avoids public fallback gateways."
                  }
                >
                  <Select
                    value={imageGatewayMode}
                    onChange={(event) => {
                      const nextMode = event.target.value as ImageGatewayMode;
                      if (nextMode !== imageGatewayMode) {
                        invalidateImageAudits();
                        setImageGatewayMode(nextMode);
                      }
                    }}
                  >
                    <option value="configured">configured gateway only</option>
                    <option value="fallbacks">configured + public fallbacks</option>
                  </Select>
                </Field>
                <div className="safety__copy">
                  <span>
                    {imageGatewayMode === "fallbacks"
                      ? "Fallbacks improve verification success but public gateways can see requested media IDs."
                      : "Configured-only mode may fail more often but keeps media reads on your chosen gateway."}
                  </span>
                </div>
              </div>
              <form
                className="row row--2"
                onSubmit={(event) => {
                  event.preventDefault();
                  addMutedTerm(muteTermInput);
                }}
              >
                <Field
                  label="mute text"
                  hint={`Hide loaded lines containing this text. ${MAX_MUTED_TERM_BYTES} bytes max.`}
                >
                  <Input
                    value={muteTermInput}
                    onChange={(event) => setMuteTermInput(event.target.value)}
                    placeholder="phrase, handle, topic..."
                    maxLength={MAX_MUTED_TERM_BYTES}
                  />
                </Field>
                <Button
                  type="submit"
                  variant="tonal"
                  disabled={!muteTermInput.trim()}
                  className="safety__add"
                >
                  add text
                </Button>
              </form>
              <div className="tracked-strip" aria-label="Muted wallets">
                <span className="tracked-strip__label">
                  muted {mutedSigners.length}
                </span>
                {mutedSigners.length ? (
                  mutedSigners.map((signer) => (
                    <button
                      type="button"
                      className="tracked-pill tracked-pill--warn"
                      key={signer}
                      onClick={() => unmuteSigner(signer)}
                      title="Unmute wallet"
                    >
                      {shorten(signer)} ×
                    </button>
                  ))
                ) : (
                  <span className="tracked-strip__empty">
                    Mute a wallet from any visible line.
                  </span>
                )}
              </div>
              <div className="tracked-strip" aria-label="Muted text">
                <span className="tracked-strip__label">
                  text {mutedTerms.length}
                </span>
                {mutedTerms.length ? (
                  mutedTerms.map((term) => (
                    <button
                      type="button"
                      className="tracked-pill tracked-pill--warn"
                      key={term}
                      onClick={() => removeMutedTerm(term)}
                      title="Remove text mute"
                    >
                      {term} ×
                    </button>
                  ))
                ) : (
                  <span className="tracked-strip__empty">
                    Add text to hide matching loaded lines.
                  </span>
                )}
              </div>
              <form
                className="row row--2"
                onSubmit={(event) => {
                  event.preventDefault();
                  addHighlightedTerm(highlightTermInput);
                }}
              >
                <Field
                  label="highlight text"
                  hint={`Mark loaded lines containing this text. ${MAX_HIGHLIGHT_TERM_BYTES} bytes max.`}
                >
                  <Input
                    value={highlightTermInput}
                    onChange={(event) => setHighlightTermInput(event.target.value)}
                    placeholder="phrase, handle, topic..."
                    maxLength={MAX_HIGHLIGHT_TERM_BYTES}
                  />
                </Field>
                <Button
                  type="submit"
                  variant="ghost"
                  disabled={!highlightTermInput.trim()}
                  className="safety__add"
                >
                  highlight
                </Button>
              </form>
              <div className="tracked-strip" aria-label="Highlighted text">
                <span className="tracked-strip__label">
                  highlights {highlightedTerms.length}
                </span>
                {highlightedTerms.length ? (
                  highlightedTerms.map((term) => (
                    <button
                      type="button"
                      className="tracked-pill tracked-pill--good"
                      key={term}
                      onClick={() => removeHighlightedTerm(term)}
                      title="Remove highlight"
                    >
                      {term} ×
                    </button>
                  ))
                ) : (
                  <span className="tracked-strip__empty">
                    Add text to mark matching loaded lines.
                  </span>
                )}
              </div>
              <AsciiDivider label="encrypted backup" />
              <div className="safety__vault">
                <Field
                  label="backup passphrase"
                  hint="Use at least 16 characters or several random words."
                >
                  <Input
                    type="password"
                    value={vaultPassphrase}
                    onChange={(event) => setVaultPassphrase(event.target.value)}
                    placeholder="passphrase"
                    autoComplete="new-password"
                  />
                </Field>
                <Field
                  label="confirm passphrase"
                  hint="Required when copying or downloading a new backup"
                  optional
                >
                  <Input
                    type="password"
                    value={vaultPassphraseConfirm}
                    onChange={(event) =>
                      setVaultPassphraseConfirm(event.target.value)
                    }
                    placeholder="repeat passphrase for export"
                    autoComplete="new-password"
                  />
                </Field>
                <Field
                  label="import backup"
                  hint="Paste encrypted Sigline settings backup JSON"
                  optional
                >
                  <Textarea
                    value={vaultImportText}
                    onChange={(event) => setVaultImportText(event.target.value)}
                    placeholder="{ schema: sigline.localVault.v1, ... }"
                    rows={4}
                  />
                </Field>
                <div className="actions">
                  <Button
                    variant="tonal"
                    icon={<Copy size={14} />}
                    onClick={copyLocalVault}
                    loading={isVaultBusy}
                    disabled={!vaultPassphrase || !vaultPassphraseConfirm}
                  >
                    copy backup
                  </Button>
                  <Button
                    variant="tonal"
                    icon={<Download size={14} />}
                    onClick={downloadLocalVault}
                    loading={isVaultBusy}
                    disabled={!vaultPassphrase || !vaultPassphraseConfirm}
                  >
                    download backup
                  </Button>
                  <Button
                    variant="ghost"
                    icon={<Download size={14} />}
                    onClick={importLocalVault}
                    loading={isVaultBusy}
                    disabled={!vaultPassphrase || !vaultImportText.trim()}
                  >
                    import backup
                  </Button>
                </div>
              </div>
            </div>
          </Panel>
        </section>

        {/* ---------------------------- MAIN GRID ----------------------------- */}
        <section className="grid">
          {/* TRANSMIT */}
          <Panel
            id="transmit"
            label="TRANSMIT"
            meta="Write a post"
            tone={isPosting ? "warn" : contractReady ? "good" : "warn"}
            pending={isPosting}
            flashKey={postFlash}
            actions={<StatusBadge tone={status.tone} text={status.text} />}
            className="grid__transmit"
          >
            <div className="row">
              <Field label="net" hint="Choose where posts are written and read">
                <Select
                  value={networkKey}
                    onChange={(event) => {
                      const next = event.target.value as NetworkKey;
                      resetFeedResults();
                      setReaderControlsOpen(true);
                      setNetworkKey(next);
                      setRpcUrl(NETWORKS[next].rpcUrl);
                      appendLog(
                      "idle",
                      `Network set to ${NETWORKS[next].short}.`,
                      "net",
                    );
                  }}
                >
                  <option value="base-sepolia">Base Sepolia · 84532</option>
                  <option value="base">Base Mainnet · 8453</option>
                </Select>
              </Field>
            </div>

            <Field
              label="contract address"
              hint="The Sigline registry contract on this network"
              error={
                contractAddress && !contractReady
                  ? "That doesn't look like a valid address"
                  : undefined
              }
            >
              <Input
                value={contractAddress}
                placeholder="0x…"
                  onChange={(event) => {
                    const nextAddress = event.target.value;
                    resetFeedResults();
                    setContractsByNetwork((current) => ({
                    ...current,
                    [networkKey]: nextAddress,
                  }));
                  }}
              />
            </Field>

            <details className="route">
              <summary>
                <span>RPC endpoint (advanced)</span>
                <span className="route__hint">
                  {shortRpc(rpcUrl || network.rpcUrl)}
                </span>
              </summary>
              <div className="route__body">
                <Field
                  label="rpc url"
                  hint="Override the default Base RPC if needed"
                >
                  <Input
                    value={rpcUrl}
                    placeholder={network.rpcUrl}
                      onChange={(event) => {
                        resetFeedResults();
                        setRpcUrl(event.target.value);
                      }}
                  />
                </Field>
              </div>
            </details>

            {composingLine ? (
              <div className="answering">
                <div>
                  <span className="answering__label">{composingMode}</span>
                  <a href={lineHref(composingLine)}>
                    line {shortHash(composingLine.contentHash)}
                  </a>
                  <span className="answering__author">
                    from {shorten(composingLine.author)}
                  </span>
                  <span className="answering__author">text optional</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setAnsweringTo(null);
                    setEchoingTo(null);
                  }}
                >
                  clear
                </button>
              </div>
            ) : null}

            <Field
              label="message"
              hint={`${postBytes}/${MAX_POST_BYTES} bytes — original Twitter-length cap${postText ? " · draft saved locally" : ""}`}
              error={
                postOverByteLimit
                  ? `${postBytes}/${MAX_POST_BYTES} bytes. Shorten this post.`
                  : undefined
              }
            >
              <Textarea
                value={postText}
                onChange={(event) => setPostText(event.target.value)}
                maxLength={MAX_POST_BYTES}
                rows={4}
                placeholder="What do you want to say?"
              />
            </Field>

            <Field
              label="image"
              hint={
                hasImagePass
                  ? "Optional. PNG, JPG, GIF, or WebP under 1 MB; post URI must be ipfs:// or ar://."
                  : imagePassLoading
                    ? "Checking image pass before image selection."
                    : "Buy an image pass to attach an offchain image."
              }
              optional
            >
              <div className="image-upload">
                <label
                  className={[
                    "image-upload__drop",
                    !canSelectImage ? "image-upload__drop--disabled" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <ImagePlus size={16} aria-hidden="true" />
                  <span>
                    {imageFile
                      ? `${imageFile.name} · ${Math.ceil(imageFile.size / 1024)} KB`
                      : "choose image"}
                  </span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    disabled={!canSelectImage}
                    onChange={(event) =>
                      selectImage(event.currentTarget.files?.[0] ?? null)
                    }
                  />
                </label>
                <div className="image-upload__route">
                  <Select
                    value={imageUploadMode}
                    onChange={(event) =>
                      setImageUploadMode(event.target.value as ImageUploadMode)
                    }
                  >
                    <option value="local-ipfs">local IPFS</option>
                    <option value="endpoint">BYO endpoint</option>
                  </Select>
                  <Input
                    value={imageUploadEndpoint}
                    placeholder={
                      imageUploadMode === "local-ipfs"
                        ? "http://127.0.0.1:5001"
                        : "https://your-byo-upload-proxy.example/upload"
                    }
                    onChange={(event) =>
                      setImageUploadEndpoint(event.target.value)
                    }
                  />
                </div>
                <div className="image-upload__pass">
                  <span>
                    image pass ·{" "}
                      {hasImagePass
                        ? "active"
                        : imagePassLoading
                          ? "checking"
                          : expectedTreasuryConfigured
                            ? `${formatEther(IMAGE_PASS_FEE_WEI)} ${network.currency}`
                            : "treasury not configured"}
                    </span>
                  {!hasImagePass ? (
                    <Button
                      variant="ghost"
                      icon={<BadgeCheck size={14} />}
                      onClick={buyImagePass}
                      loading={isBuyingImagePass}
                        disabled={
                          !contractReady ||
                          !chainAligned ||
                          !expectedTreasuryConfigured
                        }
                    >
                      buy pass
                    </Button>
                  ) : null}
                </div>
                {imagePreviewUrl ? (
                  <div className="image-upload__preview">
                    <img src={imagePreviewUrl} alt="" />
                    <div>
                      <p>{imageUpload ? imageUpload.uri : "not uploaded yet"}</p>
                      <div className="image-upload__actions">
                        <Button
                          variant="ghost"
                          icon={<ImagePlus size={14} />}
                          onClick={uploadSelectedImage}
                          loading={isUploadingImage}
                          disabled={!hasImagePass || imagePassLoading}
                        >
                          upload
                        </Button>
                        <Button variant="ghost" onClick={clearImage}>
                          clear
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </Field>

            <div className="draft-queue" aria-label="Local draft queue">
              <div className="draft-queue__head">
                <span>
                  drafts {scopedDraftQueue.length}
                  {draftQueue.length !== scopedDraftQueue.length
                    ? `/${draftQueue.length}`
                    : ""}
                  {activeDraft ? ` · editing ${draftLabel(activeDraft)}` : ""}
                </span>
                <div className="draft-queue__actions">
                  <Button
                    variant="ghost"
                    onClick={saveComposeDraft}
                    disabled={!hasDraftableCompose}
                  >
                    save draft
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={clearCompose}
                    disabled={!hasPostPayload}
                  >
                    clear compose
                  </Button>
                </div>
              </div>
              {scopedDraftQueue.length ? (
                <div className="draft-queue__list">
                  {scopedDraftQueue.map((draft) => (
                    <div
                      className={[
                        "draft-pill",
                        draft.id === activeDraftId ? "draft-pill--active" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      key={draft.id}
                    >
                      <button
                        type="button"
                        onClick={() => loadDraft(draft)}
                        title="Load this local draft into compose"
                      >
                        {draftLabel(draft)}
                        {draft.imageUri ? " · uploaded image" : ""}
                      </button>
                      <button
                        type="button"
                        className="draft-pill__delete"
                        onClick={() => discardDraft(draft.id)}
                        title="Delete this local draft"
                      >
                        <Trash2 size={12} aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="draft-queue__empty">
                  Queue keeps text, references, and uploaded image pointers only.
                </span>
              )}
            </div>

            <div className="actions">
              <Button
                variant="primary"
                icon={<Send size={14} />}
                onClick={publishPost}
                loading={isPosting || isUploadingImage}
                disabled={
                  !contractReady ||
                  !hasPostPayload ||
                    postOverByteLimit ||
                    postBlockedByImagePass ||
                    postBlockedByTreasury
                }
              >
                {isUploadingImage ? "uploading…" : isPosting ? "posting…" : "post"}
              </Button>
              {chainAligned ? (
                <Button
                  variant="ghost"
                  icon={<Wallet size={14} />}
                  onClick={connectWallet}
                >
                  {account ? "switch wallet" : "connect wallet"}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  icon={<RefreshCw size={14} />}
                  onClick={switchNetwork}
                >
                  switch network
                </Button>
              )}
              {txHref ? (
                <a
                  className="receipt"
                  href={txHref}
                  target="_blank"
                  rel="noreferrer"
                >
                  view receipt → {shortHash(lastTx)}
                </a>
              ) : null}
            </div>
          </Panel>

          {/* WALLET */}
          <Panel
            id="rig"
            label="WALLET"
            meta="Your connected account"
            tone={account ? (chainAligned ? "good" : "warn") : "idle"}
            className="grid__rig"
          >
            <div className="rig">
              <div className="rig__id">
                <Fingerprint size={28} aria-hidden="true" />
                <div>
                  <div className="rig__alias">
                    {nick.trim() || "anon"}
                    <span className="rig__alias-sep">@</span>
                    <span>{network.short}</span>
                  </div>
                  <div className="rig__addr">
                    {account ? (
                      <Hex
                        value={account}
                        href={`${network.explorer}/address/${account}`}
                        label="wallet"
                      />
                    ) : (
                      <span className="muted">— offline —</span>
                    )}
                  </div>
                </div>
              </div>

              <AsciiDivider label="state" />

              <div className="kvs">
                <KV
                  k="balance"
                  v={
                    !account ? (
                      <span className="muted">—</span>
                    ) : balanceLoading ? (
                      <Skeleton w={80} h={11} />
                    ) : balance !== null ? (
                      `${formatEthShort(balance)} ${network.currency}`
                    ) : (
                      <span className="muted">unreachable</span>
                    )
                  }
                />
                <KV
                  k="chain"
                  v={
                    walletChain === null
                      ? "—"
                      : chainAligned
                        ? `aligned · ${network.chainId.toString()}`
                        : `mismatch · ${walletChain.toString()}`
                  }
                  tone={
                    walletChain === null
                      ? "idle"
                      : chainAligned
                        ? "good"
                        : "warn"
                  }
                />
                <KV
                  k="block"
                  v={
                    telemetry.blockNumber !== null
                      ? `#${telemetry.blockNumber}`
                      : "—"
                  }
                />
                <KV
                  k="rpc"
                  v={shortRpc(rpcUrl || network.rpcUrl)}
                  tone={telemetry.online ? "good" : "bad"}
                />
              </div>

              <div className="rig__cta">
                {account ? (
                  chainAligned ? (
                    <Button
                      variant="tonal"
                      icon={<RefreshCw size={13} />}
                      onClick={() => setBalanceRefresh((n) => n + 1)}
                      block
                    >
                      refresh balance
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      icon={<RefreshCw size={13} />}
                      onClick={switchNetwork}
                      block
                    >
                      switch to {network.short}
                    </Button>
                  )
                ) : (
                  <Button
                    variant="primary"
                    icon={<Wallet size={13} />}
                    onClick={connectWallet}
                    block
                  >
                    connect wallet
                  </Button>
                )}
              </div>
            </div>
          </Panel>

          {/* IDENTITY */}
          <Panel
            label="IDENTITY"
            meta="Set an alias for your address"
            tone={isSealingId ? "warn" : "idle"}
            pending={isSealingId}
            flashKey={idFlash}
            className="grid__id"
          >
            <Field label="alias" hint="Up to 64 characters">
              <Input
                value={nick}
                onChange={(event) => setNick(event.target.value)}
                maxLength={64}
                placeholder="e.g. cipher"
              />
            </Field>
            <Field
              label="twtxt url"
              hint="Optional — link to your twtxt.txt if you have one"
              optional
            >
              <Input
                value={twtUrl}
                onChange={(event) => setTwtUrl(event.target.value)}
                maxLength={512}
                placeholder="https://your.host/twtxt.txt"
              />
            </Field>
            <div className="actions">
              <Button
                variant="primary"
                icon={<BadgeCheck size={14} />}
                onClick={publishProfile}
                loading={identityAction === "save"}
                disabled={
                  !contractReady ||
                  !expectedTreasuryConfigured ||
                  identityAction === "clear"
                }
              >
                {identityAction === "save" ? "saving…" : "save identity"}
              </Button>
              <Button
                variant="danger"
                icon={<Trash2 size={14} />}
                onClick={clearProfile}
                loading={identityAction === "clear"}
                disabled={
                  !account ||
                  !chainAligned ||
                  !contractReady ||
                  !expectedTreasuryConfigured ||
                  identityAction === "save"
                }
              >
                {identityAction === "clear" ? "clearing…" : "clear alias"}
              </Button>
            </div>
          </Panel>

          {/* ACTIVITY LOG */}
          <Panel
            label="ACTIVITY"
            meta="Recent events — last 80"
            tone={logs.some((l) => l.tone === "bad") ? "warn" : "good"}
            className="grid__log"
            dense
          >
            <LogStream
              lines={logs}
              empty="Nothing here yet — actions you take will show up here."
              height={220}
            />
          </Panel>
        </section>

        {/* ------------------------------ TRUST ------------------------------- */}
        <section id="trust" className="trust">
          <Panel
            label="TRUST MATRIX"
            meta="What this contract can and can't do"
            dense
          >
            <div className="trust__grid">
              <TrustRow
                tag="PASS FEES"
                title="Image fees sweep to one immutable treasury"
                body="Only image-pass purchases are payable. Anyone can trigger a sweep, but funds always go to the deploy-time treasury."
              />
              <TrustRow
                tag="LIMITED ADMIN"
                title="An operator can pause posting, nothing else"
                body="Admin can stop new writes in an emergency. It cannot edit or delete existing posts, and it cannot take over your account."
              />
              <TrustRow
                tag="SIZE LIMITS"
                title="Posts have hard caps"
                body="Messages up to 140 bytes. Alias up to 64. URL up to 512. Predictable gas, no surprises."
              />
                <TrustRow
                  tag="PUBLIC HISTORY"
                  title="Verification uses the RPC you choose"
                  body="Line checks compare events, stored pointers, and EIP-712 hashes through the configured RPC. Use a second provider when you need independent proof."
                />
            </div>
          </Panel>
        </section>
      </main>

      {/* ------------------------------ STATUS BAR ----------------------------- */}
      <footer className="statusbar" role="contentinfo">
        <span className="statusbar__cell">
          <StatusDot tone={telemetry.online ? "good" : "bad"} pulse />
          <span>{telemetry.online ? "RPC online" : "RPC offline"}</span>
        </span>
        <span className="statusbar__cell">
          <span className="statusbar__k">net</span>
          <span>{network.short}</span>
        </span>
        <span className="statusbar__cell">
          <span className="statusbar__k">blk</span>
          <span>
            {telemetry.blockNumber !== null
              ? `#${telemetry.blockNumber.toLocaleString()}`
              : "—"}
          </span>
        </span>
        <span className="statusbar__cell">
          <span className="statusbar__k">gas</span>
          <span>
            {telemetry.gasGwei !== null
              ? `${telemetry.gasGwei.toFixed(3)}g`
              : "—"}
          </span>
        </span>
        <span className="statusbar__cell">
          <span className="statusbar__k">wallet</span>
          <span>{account ? shorten(account) : "—"}</span>
        </span>
        <span className="statusbar__spacer" />
        <span className="statusbar__cell statusbar__cell--ghost">
          Sigline — small, signed, public.
        </span>
      </footer>
    </div>
  );
}

/* ------------------------------ sub-components ------------------------------ */

function TelemetryTile({
  icon,
  k,
  v,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  k: string;
  v: string;
  sub?: string;
  tone: StatusTone;
}) {
  return (
    <div className={`tile tile--${tone}`}>
      <div className="tile__head">
        <span className="tile__icon">{icon}</span>
        <span className="tile__k">{k}</span>
        <StatusDot tone={tone} pulse={tone === "good"} />
      </div>
      <div className="tile__v">{v}</div>
      {sub ? <div className="tile__sub">{sub}</div> : null}
    </div>
  );
}

function SigcardRow({
  card,
  explorer,
  isTracked,
  activeCircleName,
  isInActiveCircle,
  onTrack,
  onForget,
  onLabel,
  onToggleWalletFlag,
  onPinProfile,
  onClearProfilePin,
  onToggleCircle,
}: {
  card: SigcardView;
  explorer: string;
  isTracked: boolean;
  activeCircleName: string;
  isInActiveCircle: boolean;
  onTrack: (address: string) => void;
  onForget: (address: string) => void;
  onLabel: (address: string) => void;
  onToggleWalletFlag: (address: string) => void;
  onPinProfile: (card: SigcardView) => void;
  onClearProfilePin: (address: string) => void;
  onToggleCircle: (address: string) => void;
}) {
  const alias = card.nick.trim() || "anon";
  const activity =
    card.latestAt > 0 ? `latest T-${formatRelative(card.latestAt)}` : "no visible lines";
  const totalLabel = card.postCount.toLocaleString();
  const twtHref = safeExternalHref(card.twtUrl);
  const profileWatch =
    card.profileWatch?.tone === "warn" ? card.profileWatch : undefined;
  const profilePinStatus = card.profilePinStatus;
  return (
    <article className="sigcard-row">
      <div className="sigcard-row__mark" aria-hidden="true">
        <Fingerprint size={18} />
      </div>
      <div className="sigcard-row__main">
        <div className="sigcard-row__head">
          {card.localLabel ? (
            <span
              className="sigcard-row__local-label"
              title="Private label stored in this browser"
            >
              {card.localLabel}
            </span>
          ) : null}
          {card.localFlag ? (
            <span
              className={`sigcard-row__wallet-flag sigcard-row__wallet-flag--${card.localFlag}`}
              title={`Private wallet flag: ${card.localFlag}`}
            >
              {card.localFlag}
            </span>
          ) : null}
          <span className="sigcard-row__alias">{alias}</span>
          <Hex
            value={card.address}
            href={`${explorer}/address/${card.address}`}
            label="wallet"
          />
        </div>
        <div className="sigcard-row__meta">
          <span>{totalLabel} line{card.postCount === 1n ? "" : "s"}</span>
          <span aria-hidden="true">░</span>
          <span>{activity}</span>
          {card.updatedAt ? (
            <>
              <span aria-hidden="true">░</span>
              <span>sigcard {formatTime(card.updatedAt)}</span>
            </>
          ) : null}
          {twtHref ? (
            <>
              <span aria-hidden="true">░</span>
              <a href={twtHref} target="_blank" rel="noreferrer">
                twtxt
              </a>
            </>
          ) : null}
        </div>
        {profileWatch ? (
          <div className="sigcard-row__watch" title={profileWatch.detail}>
            <span>{profileWatch.label}</span>
            <em>bounded profile history · address is identity</em>
          </div>
        ) : null}
        {card.error ? (
          <div className="sigcard-row__watch" title="The current sigcard could not be read from the configured RPC.">
            <span>profile unavailable</span>
            <em>local pins stay unchanged</em>
          </div>
        ) : null}
        {card.profilePin || profilePinStatus.changed ? (
          <div
            className={[
              "sigcard-row__pin",
              profilePinStatus.tone === "warn" ? "sigcard-row__pin--warn" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            title={profilePinStatus.detail}
          >
            <span>{profilePinStatus.label}</span>
            <em>local profile pin · address is identity</em>
          </div>
        ) : null}
      </div>
      <div className="sigcard-row__actions">
        <button
          type="button"
          className="sigcard-row__track"
          onClick={() => onLabel(card.address)}
        >
          {card.localLabel ? "edit label" : "label"}
        </button>
        <button
          type="button"
          className={[
            "sigcard-row__track",
            card.localFlag ? `sigcard-row__track--flag-${card.localFlag}` : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => onToggleWalletFlag(card.address)}
          title="Cycle a private local flag for this wallet"
        >
          {card.localFlag ? `flag ${card.localFlag}` : "flag"}
        </button>
        <button
          type="button"
          className={[
            "sigcard-row__track",
            card.profilePin ? "sigcard-row__track--active" : "",
            profilePinStatus.changed ? "sigcard-row__track--warn" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => onPinProfile(card)}
          disabled={Boolean(card.error)}
          title={
            card.error
              ? "Current sigcard is unavailable; keeping the existing profile pin."
              : card.profilePin
              ? "Accept the current sigcard profile as the local pin"
              : "Pin the current sigcard profile locally"
          }
        >
          {profilePinStatus.changed
            ? "accept pin"
            : card.profilePin
              ? "pinned"
              : "pin profile"}
        </button>
        {card.profilePin ? (
          <button
            type="button"
            className="sigcard-row__track"
            onClick={() => onClearProfilePin(card.address)}
            title="Clear the local sigcard profile pin"
          >
            clear pin
          </button>
        ) : null}
        <button
          type="button"
          className="sigcard-row__track"
          onClick={() => (isTracked ? onForget(card.address) : onTrack(card.address))}
        >
          {isTracked ? "tracked" : "track"}
        </button>
        {activeCircleName ? (
          <button
            type="button"
            className={[
              "sigcard-row__track",
              isInActiveCircle ? "sigcard-row__track--active" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => onToggleCircle(card.address)}
            title={`Toggle local circle ${activeCircleName}`}
          >
            {isInActiveCircle ? "in circle" : "add circle"}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function FeedRow({
  item,
  explorer,
  authorNick,
  authorLabel,
  authorFlag,
  lineMark,
  lineNote,
  highlightTerms,
  isTracked,
  isMuted,
  isFiltered,
  activeCircleName,
  isInActiveCircle,
  isRead,
  isSaved,
  isFocused,
  isEditingNote,
  noteDraft,
  audit,
  proofAudit,
  imageAudit,
  verifiedImageUrl,
  canVerify,
  isTrusted,
  referencedLine,
  threadChildren,
  isThreadLoading,
  isThreadLoaded,
  referencedAuthorNick,
  referencedAuthorLabel,
  referencedAuthorFlag,
  referencedLineNote,
  referencedLineMark,
  onTrack,
  onForget,
  onLabel,
  onToggleWalletFlag,
  onEditNote,
  onChangeNote,
  onSaveNote,
  onClearNote,
  onCancelNote,
  onToggleMark,
  onToggleCircle,
  onMute,
  onUnmute,
  onToggleRead,
  onSave,
  onShare,
  onShareThread,
  onCopyAuthorFeed,
  onCopyBundle,
  onVerify,
  onVerifyImage,
  onAnswer,
  onEcho,
  onLoadThread,
}: {
  item: TimelineItem;
  explorer: string;
  authorNick: string;
  authorLabel: string;
  authorFlag: WalletFlag | "";
  lineMark: LineMark | "";
  lineNote: string;
  highlightTerms: string[];
  isTracked: boolean;
  isMuted: boolean;
  isFiltered: boolean;
  activeCircleName: string;
  isInActiveCircle: boolean;
  isRead: boolean;
  isSaved: boolean;
  isFocused: boolean;
  isEditingNote: boolean;
  noteDraft: string;
  audit?: LineAudit;
  proofAudit?: LineAudit;
  imageAudit?: LineAudit;
  verifiedImageUrl?: string;
  canVerify: boolean;
  isTrusted: boolean;
  referencedLine?: TimelineItem;
  threadChildren?: ThreadChildren;
  isThreadLoading: boolean;
  isThreadLoaded: boolean;
  referencedAuthorNick: string;
  referencedAuthorLabel: string;
  referencedAuthorFlag: WalletFlag | "";
  referencedLineNote: string;
  referencedLineMark: LineMark | "";
  onTrack: (address: string) => void;
  onForget: (address: string) => void;
  onLabel: (address: string) => void;
  onToggleWalletFlag: (address: string) => void;
  onEditNote: (item: TimelineItem) => void;
  onChangeNote: (value: string) => void;
  onSaveNote: (item: TimelineItem, note: string) => void;
  onClearNote: (item: TimelineItem) => void;
  onCancelNote: () => void;
  onToggleMark: (item: TimelineItem) => void;
  onToggleCircle: (address: string) => void;
  onMute: (address: string) => void;
  onUnmute: (address: string) => void;
  onToggleRead: (item: TimelineItem) => void;
  onSave: (item: TimelineItem) => void;
  onShare: (item: TimelineItem) => void;
  onShareThread: (item: TimelineItem) => void;
  onCopyAuthorFeed: (item: TimelineItem) => void;
  onCopyBundle: (item: TimelineItem) => void;
  onVerify: (item: TimelineItem) => void;
  onVerifyImage: (item: TimelineItem) => void;
  onAnswer: (item: TimelineItem) => void;
  onEcho: (item: TimelineItem) => void;
  onLoadThread: (item: TimelineItem) => void;
}) {
  const imageHref = imageUriToGateway(item.imageUri);
  const hasImageHash =
    Boolean(item.imageHash) && item.imageHash.toLowerCase() !== ZERO_HASH;
  const imageVerified = imageAudit?.tone === "good" && Boolean(verifiedImageUrl);
  const isSample = !canVerify;
  const actionBlocked = isSample || !isTrusted;
  const trustActionTitle = isSample
    ? "Scan the contract before using real line actions."
    : isTrusted
      ? ""
      : "Run verify or 2-rpc proof before using this line.";
  const refLabel = item.refKind === REF_KIND_ECHO ? "echo" : "answer";
  const answerChildren = threadChildren?.answers ?? [];
  const echoChildren = threadChildren?.echoes ?? [];
  const threadTotal = answerChildren.length + echoChildren.length;
  const threadPreview = [...answerChildren, ...echoChildren].slice(0, 2);
  const auditClass =
    audit?.tone === "good"
      ? "feed-row__track--good"
      : audit?.tone === "bad"
        ? "feed-row__track--bad"
        : audit?.tone === "warn"
          ? "feed-row__track--warn"
          : "";
  const imageAuditClass =
    imageAudit?.tone === "good"
      ? "feed-row__track--good"
      : imageAudit?.tone === "bad"
        ? "feed-row__track--bad"
        : imageAudit?.tone === "warn"
          ? "feed-row__track--warn"
          : "";
  const proofAuditClass =
    proofAudit?.tone === "good"
      ? "feed-row__track--good"
      : proofAudit?.tone === "bad"
        ? "feed-row__track--bad"
        : proofAudit?.tone === "warn"
          ? "feed-row__track--warn"
          : "";
  return (
    <article
      id={lineId(item)}
      className={[
        "feed-row",
        isFiltered ? "feed-row--muted" : "",
        highlightTerms.length ? "feed-row--highlighted" : "",
        isRead ? "feed-row--read" : "",
        isFocused ? "feed-row--focused" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="listitem"
    >
      <div className="feed-row__meta">
        <time className="feed-row__time" title={formatTime(item.createdAt)}>
          T-{formatRelative(item.createdAt)}
        </time>
        <span className="feed-row__idx">#{item.index.toString()}</span>
      </div>
      <p className="feed-row__text">{item.text}</p>
      {imageHref && imageVerified && verifiedImageUrl ? (
        <a
          className="feed-row__image"
          href={verifiedImageUrl}
          target="_blank"
          rel="noreferrer"
        >
          <img
            src={verifiedImageUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        </a>
      ) : imageHref ? (
        <div className="feed-row__image-gate">
          <ImagePlus size={16} aria-hidden="true" />
          <span>
            {hasImageHash
              ? "image hidden until hash check passes"
              : "image hidden without a hash"}
          </span>
        </div>
      ) : null}
      {lineMark ? (
        <div className={`feed-row__mark feed-row__mark--${lineMark}`}>
          <span>private mark</span>
          <strong>{lineMark}</strong>
        </div>
      ) : null}
      {highlightTerms.length ? (
        <div className="feed-row__highlights" aria-label="Highlighted terms">
          <span>highlight</span>
          {highlightTerms.map((term) => (
            <strong key={term}>{term}</strong>
          ))}
        </div>
      ) : null}
      {lineNote && !isEditingNote ? (
        <div
          id={`note-${item.contentHash.slice(2).toLowerCase()}`}
          className="feed-row__note"
        >
          <span>private note</span>
          <p>{lineNote}</p>
        </div>
      ) : null}
      {isEditingNote ? (
        <form
          id={`note-${item.contentHash.slice(2).toLowerCase()}`}
          className="feed-row__note-editor"
          onSubmit={(event) => {
            event.preventDefault();
            onSaveNote(item, noteDraft);
          }}
        >
          <label>
            <span>private note</span>
            <em>{MAX_LINE_NOTE_BYTES} UTF-8 bytes max</em>
          </label>
          <textarea
            value={noteDraft}
            onChange={(event) => onChangeNote(event.target.value)}
            placeholder="What should you remember about this line?"
          />
          <div className="feed-row__note-actions">
            <button type="submit" className="feed-row__track feed-row__track--good">
              save note
            </button>
            <button
              type="button"
              className="feed-row__track feed-row__track--warn"
              onClick={() => onClearNote(item)}
              disabled={!lineNote}
            >
              clear
            </button>
            <button
              type="button"
              className="feed-row__track"
              onClick={onCancelNote}
            >
              cancel
            </button>
          </div>
        </form>
      ) : null}
      <div className="feed-row__foot">
        <span className="feed-row__label">from</span>
        {authorLabel ? (
          <span
            className="feed-row__local-label"
            title={`private label for ${item.author}`}
          >
            {authorLabel}
          </span>
        ) : null}
        {authorFlag ? (
          <span
            className={`feed-row__wallet-flag feed-row__wallet-flag--${authorFlag}`}
            title={`Private wallet flag: ${authorFlag}`}
          >
            {authorFlag}
          </span>
        ) : null}
        {authorNick ? (
          <span className="feed-row__alias" title={`alias for ${item.author}`}>
            {authorNick}
          </span>
        ) : null}
        <Hex
          value={item.author}
          href={`${explorer}/address/${item.author}`}
          label="author"
        />
        <button
          type="button"
          className="feed-row__track"
          onClick={() => onCopyAuthorFeed(item)}
          disabled={isSample}
          title={
            isSample
              ? "Scan the contract before copying public author feed links."
              : "Copy a public feed link scoped to this wallet."
          }
        >
          feed
        </button>
        <button
          type="button"
          className="feed-row__track"
          onClick={() => onLabel(item.author)}
          disabled={isSample}
          title={isSample ? "Scan the contract before labeling real wallets." : ""}
        >
          {authorLabel ? "label" : "add label"}
        </button>
        <button
          type="button"
          className={[
            "feed-row__track",
            authorFlag ? `feed-row__track--flag-${authorFlag}` : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => onToggleWalletFlag(item.author)}
          disabled={isSample}
          title={
            isSample
              ? "Scan the contract before flagging real wallets."
              : "Cycle a private local flag for this wallet."
          }
        >
          {authorFlag ? `flag ${authorFlag}` : "flag"}
        </button>
        <button
          type="button"
          className="feed-row__track"
          onClick={() => (isTracked ? onForget(item.author) : onTrack(item.author))}
          disabled={isSample}
          title={isSample ? "Scan the contract before tracking real wallets." : ""}
        >
          {isTracked ? "tracked" : "track"}
        </button>
        <button
          type="button"
          className="feed-row__track feed-row__track--warn"
          onClick={() => (isMuted ? onUnmute(item.author) : onMute(item.author))}
          disabled={isSample}
          title={isSample ? "Scan the contract before muting real wallets." : ""}
        >
          {isMuted ? "muted" : "mute"}
        </button>
        {activeCircleName ? (
          <button
            type="button"
            className={[
              "feed-row__track",
              isInActiveCircle ? "feed-row__track--good" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => onToggleCircle(item.author)}
            disabled={isSample}
            title={
              isSample
                ? "Scan the contract before editing local circles."
                : `Toggle local circle ${activeCircleName}.`
            }
          >
            {isInActiveCircle ? "in circle" : "add circle"}
          </button>
        ) : null}
        <span className="feed-row__sep" aria-hidden="true">
          ░
        </span>
        <span className="feed-row__label">blk</span>
        <span className="feed-row__blk">#{item.blockNumber}</span>
        <span className="feed-row__sep" aria-hidden="true">
          ░
        </span>
        <span className="feed-row__label">tx</span>
        <Hex
          value={item.txHash}
          href={`${explorer}/tx/${item.txHash}`}
          label="tx"
        />
        <span className="feed-row__sep" aria-hidden="true">
          ░
        </span>
        <span className="feed-row__label">crc</span>
        <span className="feed-row__crc">{shortHash(item.contentHash)}</span>
        <a className="feed-row__link" href={lineHref(item)}>
          line
        </a>
        <button
          type="button"
          className="feed-row__track"
          onClick={() => onAnswer(item)}
          disabled={actionBlocked}
          title={trustActionTitle}
        >
          answer
        </button>
        <button
          type="button"
          className="feed-row__track"
          onClick={() => onEcho(item)}
          disabled={actionBlocked}
          title={trustActionTitle}
        >
          echo
        </button>
        <button
          type="button"
          className={[
            "feed-row__track",
            isThreadLoaded || threadTotal ? "feed-row__track--good" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => onLoadThread(item)}
          disabled={actionBlocked || isThreadLoading}
          title={
            actionBlocked
              ? trustActionTitle
              : "Load answers and echoes that reference this line in the latest bounded scan window."
          }
        >
          {isSample
            ? "thread"
            : isThreadLoading
            ? "loading"
            : threadTotal
              ? "refresh thread"
              : isThreadLoaded
                ? "thread checked"
                : "load thread"}
        </button>
        <button
          type="button"
          className={[
            "feed-row__track",
            isRead ? "feed-row__track--read" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => onToggleRead(item)}
          disabled={isSample}
          title={
            isSample
              ? "Scan the contract before marking real lines read."
              : "Toggle local read state for this line."
          }
        >
          {isRead ? "read" : "unread"}
        </button>
        <button
          type="button"
          className={[
            "feed-row__track",
            isSaved ? "feed-row__track--saved" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => onSave(item)}
          disabled={isSample || (!isTrusted && !isSaved)}
          title={isSaved ? "Remove this saved line." : trustActionTitle}
        >
          {isSaved ? "saved" : "save"}
        </button>
        <button
          type="button"
          className={[
            "feed-row__track",
            lineNote ? "feed-row__track--saved" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => onEditNote(item)}
          title="Add or edit a private local note for this line."
        >
          {lineNote ? "note" : "add note"}
        </button>
        <button
          type="button"
          className={[
            "feed-row__track",
            lineMark ? "feed-row__track--saved" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => onToggleMark(item)}
          title="Cycle a private local mark for this line."
        >
          {lineMark ? `mark ${lineMark}` : "mark"}
        </button>
        <button
          type="button"
          className="feed-row__track"
          onClick={() => onShare(item)}
          disabled={actionBlocked}
          title={trustActionTitle}
        >
          share
        </button>
        <button
          type="button"
          className="feed-row__track"
          onClick={() => onShareThread(item)}
          disabled={actionBlocked}
          title={
            actionBlocked
              ? trustActionTitle
              : "Copy a public link that loads this verified line and its bounded thread."
          }
        >
          copy thread
        </button>
        <button
          type="button"
          className="feed-row__track"
          onClick={() => onCopyBundle(item)}
          disabled={actionBlocked}
          title={
            actionBlocked
              ? trustActionTitle
              : "Copy this line with public link and visible verification state."
          }
        >
          bundle
        </button>
        <button
          type="button"
          className={["feed-row__track", auditClass].filter(Boolean).join(" ")}
          onClick={() => onVerify(item)}
          title={
            canVerify
              ? (audit?.detail ?? "Compare this event to line(author,index).")
              : "Sample rows are not on chain."
          }
          disabled={!canVerify || audit?.tone === "warn"}
        >
          {canVerify ? (audit?.text ?? "verify") : "sample"}
        </button>
        {proofAudit ? (
          <span
            className={["feed-row__proof", proofAuditClass]
              .filter(Boolean)
              .join(" ")}
            title={proofAudit.detail}
          >
            {proofAudit.text}
          </span>
        ) : null}
        {hasImageHash ? (
          <>
            <span className="feed-row__sep" aria-hidden="true">
              ░
            </span>
            <span className="feed-row__label">img</span>
            <span className="feed-row__crc">{shortHash(item.imageHash)}</span>
            <button
              type="button"
              className={["feed-row__track", imageAuditClass]
                .filter(Boolean)
                .join(" ")}
              onClick={() => onVerifyImage(item)}
              title={
                imageHref
                  ? (imageAudit?.detail ??
                    "Fetch image bytes and compare SHA-256.")
                  : "Image URI is not renderable by this client."
              }
              disabled={!imageHref || imageAudit?.tone === "warn"}
            >
              {imageAudit?.text ?? "check"}
            </button>
          </>
        ) : null}
        {item.refKind !== REF_KIND_NONE && item.refHash !== ZERO_HASH ? (
          <>
            <span className="feed-row__sep" aria-hidden="true">
              ░
            </span>
            <span className="feed-row__label">
              {refLabel}
            </span>
            <a className="feed-row__link" href={lineHashHref(item.refHash)}>
              {shortHash(item.refHash)}
            </a>
          </>
        ) : null}
      </div>
      {referencedLine ? (
        <a className="feed-row__ref-preview" href={lineHref(referencedLine)}>
          <span className="feed-row__ref-k">
            {refLabel} loaded line
            {referencedAuthorLabel ? ` · ${referencedAuthorLabel}` : ""}
            {referencedAuthorFlag ? ` · ${referencedAuthorFlag}` : ""}
            {referencedAuthorNick ? ` · ${referencedAuthorNick}` : ""}
            {referencedLineMark ? ` · ${referencedLineMark}` : ""}
            {referencedLineNote ? " · noted" : ""}
          </span>
          <span className="feed-row__ref-text">
            {referencedLine.text.trim() || "media/reference only"}
          </span>
        </a>
      ) : item.refKind !== REF_KIND_NONE && item.refHash !== ZERO_HASH ? (
        <a className="feed-row__ref-preview" href={lineHashHref(item.refHash)}>
          <span className="feed-row__ref-k">{refLabel} unresolved</span>
          <span className="feed-row__ref-text">
            Parent line is not loaded in this scan window.
          </span>
        </a>
      ) : null}
      {threadTotal ? (
        <div className="feed-row__thread" aria-label="Loaded thread activity">
          <div className="feed-row__thread-head">
            <span>thread lens</span>
            <strong>
              {answerChildren.length} answer
              {answerChildren.length === 1 ? "" : "s"} · {echoChildren.length} echo
              {echoChildren.length === 1 ? "" : "es"}
            </strong>
          </div>
          <div className="feed-row__thread-list">
            {threadPreview.map((child) => (
              <a
                className="feed-row__thread-link"
                href={lineHref(child)}
                key={child.id}
              >
                <span>
                  {child.refKind === REF_KIND_ECHO ? "echo" : "answer"} #
                  {child.index.toString()}
                </span>
                <em>{child.text.trim() || "media/reference only"}</em>
              </a>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function FeedSkeleton() {
  return (
    <article className="feed-row feed-row--skeleton">
      <div className="feed-row__meta">
        <Skeleton w={42} h={10} />
        <Skeleton w={30} h={10} />
      </div>
      <Skeleton w="80%" h={18} />
      <Skeleton w="60%" h={10} />
    </article>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="empty">
      <pre aria-hidden="true">{`
   ░░░░░░░░░░░░░░░░░░░
   ░ no carrier · 0x0 ░
   ░░░░░░░░░░░░░░░░░░░`}</pre>
      <h4>{title}</h4>
      <p>{hint}</p>
    </div>
  );
}

function TrustRow({
  tag,
  title,
  body,
}: {
  tag: string;
  title: string;
  body: string;
}) {
  return (
    <article className="trust-row">
      <span className="trust-row__tag">{tag}</span>
      <div className="trust-row__body">
        <h4>{title}</h4>
        <p>{body}</p>
      </div>
    </article>
  );
}

/* ------------------------------- formatters -------------------------------- */

function shortRpc(url: string) {
  try {
    const u = new URL(url);
    return u.host;
  } catch {
    return url || "—";
  }
}

function shortHash(hash: string) {
  if (!hash) return "—";
  if (hash.length <= 12) return hash;
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

function isSampleItem(item: TimelineItem) {
  return item.id.startsWith("sample-");
}

function hasVerifiableImage(item: TimelineItem) {
  return Boolean(item.imageUri) && item.imageHash.toLowerCase() !== ZERO_HASH;
}

function getImageVerificationErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : getDisplayErrorMessage(error);
}

function getPermalinkErrorMessage(error: unknown) {
  if (error instanceof Error) {
    if (error.message === "BAD_START_BLOCK") return getDisplayErrorMessage(error);
    if (error.message.startsWith("REGISTRY_")) return getDisplayErrorMessage(error);
    return error.message;
  }
  return getDisplayErrorMessage(error);
}

function lineId(item: TimelineItem) {
  return `line-${item.contentHash.slice(2)}`;
}

function lineHref(item: TimelineItem) {
  return lineHashHref(item.contentHash);
}

function lineHashHref(contentHash: string) {
  return `#line-${contentHash.slice(2)}`;
}

function channelLabel(channel: ChannelId | "") {
  if (!channel) return "";
  if (channel.startsWith("tag:")) return `#${channel.slice(4)}`;
  return `$${channel.slice(5)}`;
}

function readerSourceSummary(source: ReaderSource) {
  return [
    source.networkKey,
    shorten(source.contractAddress),
    source.scanScope === "address" && source.author
      ? shorten(source.author)
      : "everyone",
    source.fromBlock ? `from #${source.fromBlock}` : "latest window",
    source.channel ? channelLabel(source.channel) : "",
    source.mode !== "all" ? source.mode : "",
    source.sort,
  ]
    .filter(Boolean)
    .join(" · ");
}

function safeExternalHref(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : "";
  } catch {
    return "";
  }
}

async function queryPostEvents(
  provider: JsonRpcProvider,
  contract: Contract,
  filters: ContractEventName[],
  startBlock: number,
  eventLimit = TIMELINE_LIMIT,
  blockWindow?: number,
  windowAnchor: "latest" | "forward" = "latest",
  options: { endBlock?: number } = {},
) {
  const latestBlock = await provider.getBlockNumber();
  const effectiveLatestBlock =
    options.endBlock === undefined
      ? latestBlock
      : Math.min(options.endBlock, latestBlock);
  if (startBlock > effectiveLatestBlock) {
    return {
      events: [],
      latestBlock,
      scannedFromBlock: effectiveLatestBlock,
      scannedToBlock: effectiveLatestBlock,
    };
  }
  const scannedFromBlock =
    blockWindow && blockWindow > 0 && windowAnchor === "latest"
      ? Math.max(startBlock, effectiveLatestBlock - blockWindow + 1)
      : startBlock;
  const scannedToBlock =
    blockWindow && blockWindow > 0 && windowAnchor === "forward"
      ? Math.min(effectiveLatestBlock, startBlock + blockWindow - 1)
      : effectiveLatestBlock;

  const events: Array<EventLog | Log> = [];
  if (windowAnchor === "forward") {
    let cursorStart = scannedFromBlock;
    while (cursorStart <= scannedToBlock) {
      const cursorEnd = Math.min(scannedToBlock, cursorStart + LOG_CHUNK_SIZE - 1);
      const groups = await Promise.all(
        filters.map((filter) => contract.queryFilter(filter, cursorStart, cursorEnd)),
      );
      events.push(...groups.flat());
      cursorStart = cursorEnd + 1;
    }
    return { events, latestBlock, scannedFromBlock, scannedToBlock };
  }

  let cursorEnd = scannedToBlock;
  let actualScannedFromBlock = scannedFromBlock;
  while (cursorEnd >= scannedFromBlock && events.length < eventLimit) {
    const cursorStart = Math.max(scannedFromBlock, cursorEnd - LOG_CHUNK_SIZE + 1);
    actualScannedFromBlock = cursorStart;
    const groups = await Promise.all(
      filters.map((filter) => contract.queryFilter(filter, cursorStart, cursorEnd)),
    );
    events.push(...groups.flat());
    cursorEnd = cursorStart - 1;
  }
  return {
    events,
    latestBlock,
    scannedFromBlock: actualScannedFromBlock,
    scannedToBlock,
  };
}

async function queryProfileEvents(
  provider: JsonRpcProvider,
  contract: Contract,
  fromBlock: string,
) {
  const latestBlock = await provider.getBlockNumber();
  let startBlock = Math.max(0, latestBlock - PROFILE_SCAN_BLOCK_WINDOW + 1);
  try {
    startBlock = Math.max(parseBlock(fromBlock), startBlock);
  } catch {
    // Invalid feed scan input should not break sigcard rendering.
  }
  const filters = [
    contract.filters.ProfileUpdated(),
    contract.filters.ProfileCleared(),
  ];
  const events: Array<EventLog | Log> = [];
  let cursorEnd = latestBlock;
  while (cursorEnd >= startBlock && events.length < PROFILE_EVENT_LIMIT) {
    const cursorStart = Math.max(startBlock, cursorEnd - LOG_CHUNK_SIZE + 1);
    const groups = await Promise.all(
      filters.map((filter) => contract.queryFilter(filter, cursorStart, cursorEnd)),
    );
    events.push(...groups.flat());
    cursorEnd = cursorStart - 1;
  }
  return events
    .filter((event): event is EventLog => event instanceof EventLog)
    .map(toProfileEventItem)
    .filter((event): event is ProfileEventItem => Boolean(event))
    .sort(
      (a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex,
    )
    .slice(-PROFILE_EVENT_LIMIT);
}

function mergeTimelineItems(
  incoming: TimelineItem[],
  current: TimelineItem[],
) {
  const byId = new Map<string, TimelineItem>();
  [...incoming, ...current].forEach((item) => {
    byId.set(item.id, item);
  });
  return [...byId.values()].sort(
    (a, b) => b.createdAt - a.createdAt || Number(b.index - a.index),
  );
}

function takeTimelineRows(rows: TimelineItem[], focusedHash = "") {
  if (!focusedHash) return rows.slice(0, TIMELINE_LIMIT);
  const normalized = focusedHash.toLowerCase();
  const focusedIndex = rows.findIndex(
    (item) => item.contentHash.toLowerCase() === normalized,
  );
  if (focusedIndex <= 0) {
    return rows.slice(0, TIMELINE_LIMIT);
  }
  const focusedRows = [
    rows[focusedIndex],
    ...rows.slice(0, focusedIndex),
    ...rows.slice(focusedIndex + 1),
  ];
  return focusedRows.slice(0, TIMELINE_LIMIT);
}

function formatEthShort(value: string) {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  if (n === 0) return "0.0000";
  if (n < 0.0001) return n.toExponential(2);
  if (n < 1) return n.toFixed(5);
  if (n < 1000) return n.toFixed(4);
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
