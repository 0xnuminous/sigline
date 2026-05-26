// Base command-deck: composition layer for Sigline.
// Owns wallet/contract state; delegates visuals to the design-system primitives.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  BadgeCheck,
  Cpu,
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
  Wallet,
  Zap,
} from "lucide-react";
import {
  BrowserProvider,
  Contract,
  EventLog,
  JsonRpcProvider,
  getAddress,
} from "ethers";
import {
  ABI,
  ContractMap,
  MAX_POST_BYTES,
  NetworkKey,
  NETWORKS,
  STORAGE_KEY,
  StatusTone,
  TimelineItem,
  assertContractDeployed,
  ensureWalletOnNetwork,
  formatRelative,
  formatTime,
  getDisplayErrorMessage,
  isAddressLike,
  parseBlock,
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
  DEFAULT_IMAGE_UPLOAD_ENDPOINT,
  DEFAULT_IMAGE_UPLOAD_MODE,
  ImageUploadMode,
  ImageUploadResult,
  imageUriToGateway,
  uploadImage,
  validateImageFile,
} from "./uploads";

type ScanScope = "all" | "tracked" | "address";

const ASCII_TITLE = `
 ██████╗  █████╗ ███████╗███████╗   ████████╗██╗    ██╗████████╗██╗  ██╗████████╗
 ██╔══██╗██╔══██╗██╔════╝██╔════╝   ╚══██╔══╝██║    ██║╚══██╔══╝╚██╗██╔╝╚══██╔══╝
 ██████╔╝███████║███████╗█████╗        ██║   ██║ █╗ ██║   ██║    ╚███╔╝    ██║
 ██╔══██╗██╔══██║╚════██║██╔══╝        ██║   ██║███╗██║   ██║    ██╔██╗    ██║
 ██████╔╝██║  ██║███████║███████╗      ██║   ╚███╔███╔╝   ██║   ██╔╝ ██╗   ██║
 ╚═════╝ ╚═╝  ╚═╝╚══════╝╚══════╝      ╚═╝    ╚══╝╚══╝    ╚═╝   ╚═╝  ╚═╝   ╚═╝
`.replace(/^\n/, "");

export default function App() {
  const saved = readSavedSettings();
  const [networkKey, setNetworkKey] = useState<NetworkKey>(saved.networkKey);
  const network = NETWORKS[networkKey];
  const [contractsByNetwork, setContractsByNetwork] = useState<ContractMap>(
    saved.contractsByNetwork,
  );
  const contractAddress = contractsByNetwork[networkKey];
  const [rpcUrl, setRpcUrl] = useState(saved.rpcUrl);
  const [fromBlock, setFromBlock] = useState(saved.fromBlock);
  const [account, setAccount] = useState("");
  const [walletChain, setWalletChain] = useState<bigint | null>(null);
  const [status, setStatus] = useState<{ tone: StatusTone; text: string }>({
    tone: "idle",
    text: "Ready. Connect a wallet to start posting.",
  });
  const [postText, setPostText] = useState("");
  const [nick, setNick] = useState("");
  const [twtUrl, setTwtUrl] = useState("");
  const [targetAddress, setTargetAddress] = useState("");
  const [scanScope, setScanScope] = useState<ScanScope>(
    saved.scanScope === "tracked" || saved.scanScope === "address"
      ? saved.scanScope
      : "all",
  );
  const [trackedSigners, setTrackedSigners] = useState<string[]>(() =>
    (saved.trackedSigners ?? [])
      .filter((value) => isAddressLike(value))
      .map((value) => getAddress(value)),
  );
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [hasQueriedTimeline, setHasQueriedTimeline] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isSealingId, setIsSealingId] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState("");
  const [imageUpload, setImageUpload] = useState<ImageUploadResult | null>(null);
  const [imageUploadMode, setImageUploadMode] = useState<ImageUploadMode>(
    saved.imageUploadMode === "endpoint" || saved.imageUploadMode === "local-ipfs"
      ? saved.imageUploadMode
      : DEFAULT_IMAGE_UPLOAD_MODE,
  );
  const [imageUploadEndpoint, setImageUploadEndpoint] = useState(
    saved.imageUploadEndpoint || DEFAULT_IMAGE_UPLOAD_ENDPOINT,
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

  // Persist settings.
  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        networkKey,
        contractsByNetwork,
        rpcUrl,
        fromBlock,
        imageUploadMode,
        imageUploadEndpoint,
        scanScope,
        trackedSigners,
      }),
    );
  }, [
    networkKey,
    contractsByNetwork,
    rpcUrl,
    fromBlock,
    imageUploadMode,
    imageUploadEndpoint,
    scanScope,
    trackedSigners,
  ]);

  useEffect(() => {
    return () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    };
  }, [imagePreviewUrl]);

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
        setAccount(accounts[0]);
        setTargetAddress((current) => current || accounts[0]);
        appendLog("good", `Connected as ${shorten(accounts[0])}`, "wallet");
      } else {
        setAccount("");
        setTargetAddress("");
        setWalletChain(null);
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
  }, [appendLog]);

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
  const postBytes = useMemo(
    () => new TextEncoder().encode(postText.trim()).length,
    [postText],
  );
  const chainAligned = walletChain === null || walletChain === network.chainId;
  const isPreviewTimeline = !hasQueriedTimeline && timeline.length === 0;
  const shownTimeline = isPreviewTimeline ? samplePosts : timeline;
  const trackedSet = useMemo(
    () => new Set(trackedSigners.map((value) => value.toLowerCase())),
    [trackedSigners],
  );
  // The wallet is actively signing/waiting on a tx (not just scanning).
  const walletBusy = isPosting || isSealingId;

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
      setAccount(address);
      setTargetAddress((current) => current || address);
      setWalletChain(currentNetwork.chainId);
      setStatus({ tone: "good", text: "Wallet connected." });
      appendLog("good", `Connected ${shorten(address)}`, "wallet");
    } catch (error) {
      const msg = getDisplayErrorMessage(error);
      setStatus({ tone: "bad", text: msg });
      appendLog("bad", msg, "wallet");
    }
  }, [appendLog]);

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

  const trackSigner = useCallback(
    (value: string) => {
      if (!isAddressLike(value)) {
        setStatus({ tone: "warn", text: "That signer address is invalid." });
        return;
      }
      const normalized = getAddress(value);
      setTrackedSigners((current) => {
        if (current.some((item) => item.toLowerCase() === normalized.toLowerCase())) {
          return current;
        }
        return [...current, normalized].sort();
      });
      setStatus({ tone: "good", text: `Tracking ${shorten(normalized)}.` });
      appendLog("good", `Tracking signer ${shorten(normalized)}.`, "track");
    },
    [appendLog],
  );

  const forgetSigner = useCallback(
    (value: string) => {
      const normalized = getAddress(value);
      setTrackedSigners((current) =>
        current.filter((item) => item.toLowerCase() !== normalized.toLowerCase()),
      );
      setStatus({ tone: "idle", text: `Stopped tracking ${shorten(normalized)}.` });
      appendLog("idle", `Forgot signer ${shorten(normalized)}.`, "track");
    },
    [appendLog],
  );

  const loadTimeline = useCallback(async () => {
    if (!contractReady) {
      setStatus({
        tone: "warn",
        text: "Set a contract address before scanning.",
      });
      return;
    }
    const normalizedTarget = targetAddress.trim();
    if (scanScope === "address" && !normalizedTarget) {
      setStatus({ tone: "warn", text: "Enter a signer address to scan." });
      return;
    }
    if (normalizedTarget && !isAddressLike(normalizedTarget)) {
      setStatus({
        tone: "warn",
        text: "That author address doesn't look valid.",
      });
      return;
    }
    if (scanScope === "tracked" && trackedSigners.length === 0) {
      setStatus({ tone: "warn", text: "Track at least one signer first." });
      return;
    }
    try {
      setIsLoading(true);
      appendLog(
        "idle",
        scanScope === "tracked"
          ? `Scanning ${trackedSigners.length} tracked signer${trackedSigners.length === 1 ? "" : "s"}…`
          : "Scanning for posts…",
        "scan",
      );
      const provider = new JsonRpcProvider(
        rpcUrl || network.rpcUrl,
        Number(network.chainId),
      );
      await assertContractDeployed(provider, contractAddress);
      const contract = new Contract(contractAddress, ABI, provider);
      const startBlock = parseBlock(fromBlock);
      const signers =
        scanScope === "tracked"
          ? trackedSigners
          : scanScope === "address"
            ? [getAddress(normalizedTarget)]
            : [];
      const filters = signers.length
        ? signers.map((address) => contract.filters.PostPosted(address))
        : [contract.filters.PostPosted()];
      const eventGroups = await Promise.all(
        filters.map((filter) => contract.queryFilter(filter, startBlock, "latest")),
      );
      const events = eventGroups.flat();
      const parsed = events
        .filter((event): event is EventLog => event instanceof EventLog)
        .map((event) => toTimelineItem(event))
        .sort((a, b) => b.createdAt - a.createdAt || Number(b.index - a.index));
      setTimeline(parsed.slice(0, 40));
      setHasQueriedTimeline(true);
      const tone: StatusTone = parsed.length ? "good" : "idle";
      const text = parsed.length
        ? `Loaded ${parsed.length} post${parsed.length === 1 ? "" : "s"}.`
        : "No posts found in this range.";
      setStatus({ tone, text });
      appendLog(tone, text, "scan");
      if (parsed.length) setScanFlash((n) => n + 1);
    } catch (error) {
      const msg = getDisplayErrorMessage(error);
      setStatus({ tone: "bad", text: msg });
      appendLog("bad", msg, "scan");
    } finally {
      setIsLoading(false);
    }
  }, [
    appendLog,
    contractAddress,
    contractReady,
    fromBlock,
    network,
    rpcUrl,
    scanScope,
    targetAddress,
    trackedSigners,
  ]);

  const clearImage = useCallback(() => {
    setImageFile(null);
    setImageUpload(null);
    setImagePreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return "";
    });
  }, []);

  const selectImage = useCallback((file: File | null) => {
    setImageUpload(null);
    setImageFile(null);
    setImagePreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return "";
    });
    if (!file) return;
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
  }, []);

  const uploadSelectedImage = useCallback(async () => {
    if (!imageFile) return null;
    setIsUploadingImage(true);
    try {
      appendLog("idle", `Uploading image via ${imageUploadMode}.`, "image");
      const uploaded = await uploadImage(
        imageFile,
        imageUploadMode,
        imageUploadEndpoint,
      );
      setImageUpload(uploaded);
      appendLog("good", `Image stored at ${uploaded.uri}.`, "image");
      return uploaded;
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Image upload failed.";
      setStatus({ tone: "bad", text: msg });
      appendLog("bad", msg, "image");
      return null;
    } finally {
      setIsUploadingImage(false);
    }
  }, [appendLog, imageFile, imageUploadEndpoint, imageUploadMode]);

  const publishPost = useCallback(async () => {
    if (!contractReady) {
      setStatus({
        tone: "warn",
        text: "Set a contract address before posting.",
      });
      return;
    }
    if (!postText.trim() && !imageFile && !imageUpload) {
      setStatus({ tone: "warn", text: "Write something first." });
      return;
    }
    if (postBytes > MAX_POST_BYTES) {
      setStatus({
        tone: "warn",
        text: `Keep posts to ${MAX_POST_BYTES} bytes. This one is ${postBytes}.`,
      });
      return;
    }
    try {
      setIsPosting(true);
      const uploaded = imageUpload || (imageFile ? await uploadSelectedImage() : null);
      if (imageFile && !uploaded) return;
      appendLog("idle", "Preparing post…", "post");
      await ensureWalletOnNetwork(network);
      const contract = await writableContract(contractAddress, network);
      const tx = await contract.post(
        postText.trim(),
        uploaded?.uri ?? "",
        uploaded?.hash ??
          "0x0000000000000000000000000000000000000000000000000000000000000000",
      );
      setStatus({
        tone: "idle",
        text: "Submitted. Waiting for confirmation…",
      });
      appendLog("idle", `Submitted tx ${shorten(tx.hash)}`, "post");
      const receipt = await tx.wait();
      setLastTx(receipt.hash);
      setStatus({ tone: "good", text: "Post confirmed." });
      appendLog(
        "good",
        `Confirmed in block ${receipt.blockNumber} (${shorten(receipt.hash)}).`,
        "post",
      );
      setPostFlash((n) => n + 1);
      setPostText("");
      clearImage();
      setBalanceRefresh((n) => n + 1);
      await loadTimeline();
    } catch (error) {
      const msg = getDisplayErrorMessage(error);
      setStatus({ tone: "bad", text: msg });
      appendLog("bad", msg, "tx");
    } finally {
      setIsPosting(false);
    }
  }, [
    appendLog,
    clearImage,
    contractAddress,
    contractReady,
    imageFile,
    imageUpload,
    loadTimeline,
    network,
    postBytes,
    postText,
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
    try {
      setIsSealingId(true);
      appendLog("idle", "Preparing identity update…", "identity");
      await ensureWalletOnNetwork(network);
      const contract = await writableContract(contractAddress, network);
      const tx = await contract.setProfile(nick.trim(), twtUrl.trim());
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
      setBalanceRefresh((n) => n + 1);
    } catch (error) {
      const msg = getDisplayErrorMessage(error);
      setStatus({ tone: "bad", text: msg });
      appendLog("bad", msg, "tx");
    } finally {
      setIsSealingId(false);
    }
  }, [appendLog, contractAddress, contractReady, network, nick, twtUrl]);

  /* --------------------------------- render --------------------------------- */

  // Onboarding hint that types itself out below the title.
  const greeting = useTypewriter(
    "$ connect wallet → pick network → add contract → post",
    14,
  );

  const txHref = lastTx ? `${network.explorer}/tx/${lastTx}` : "";

  return (
    <div className="deck">
      <FiberBackdrop />

      {/* ------------------------------- TOP BAR ------------------------------ */}
      <header className="topbar" role="banner">
        <a className="brand" href="#deck" aria-label="Sigline deck">
          <Terminal size={14} aria-hidden="true" />
          <span className="brand__name">BASE</span>
          <span className="brand__dot">·</span>
          <span className="brand__sub">SIGLINE</span>
          <span className="brand__rev">v0.1</span>
        </a>

        <nav className="topnav" aria-label="Primary">
          <a href="#transmit">
            <Send size={12} aria-hidden="true" />
            transmit
          </a>
          <a href="#receive">
            <Radio size={12} aria-hidden="true" />
            receive
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
        {/* ---------------------------- COMMAND DECK -------------------------- */}
        <section className="cmd" aria-label="Command deck">
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
            The contract stores posts only; your wallet signs each write.
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

        {/* ----------------------------- RECEIVE ------------------------------ */}
        <section id="receive" className="receive">
          <Panel
            label="FEED"
            meta="Read posts from the contract"
            tone={
              isLoading ? "warn" : shownTimeline.length > 0 ? "good" : "idle"
            }
            pending={isLoading}
            flashKey={scanFlash}
            actions={
              <span className="receive__count">
                {isPreviewTimeline ? "sample" : `${timeline.length} loaded`}
              </span>
            }
          >
            <div className="receive__bar">
              <Field label="wire scope" hint="Choose who to scan">
                <Select
                  value={scanScope}
                  onChange={(event) => setScanScope(event.target.value as ScanScope)}
                >
                  <option value="all">all signers</option>
                  <option value="tracked">tracked only</option>
                  <option value="address">one signer</option>
                </Select>
              </Field>
              <Field
                label="signer address"
                hint="Track or scan one signer"
                optional
              >
                <Input
                  value={targetAddress}
                  placeholder="0x… (optional)"
                  onChange={(event) => setTargetAddress(event.target.value)}
                />
              </Field>
              <Field label="start block" hint="First block to scan for posts">
                <Input
                  value={fromBlock}
                  onChange={(event) => setFromBlock(event.target.value)}
                  inputMode="numeric"
                  placeholder="0"
                />
              </Field>
              <div className="receive__bar-actions">
                <Button
                  variant="ghost"
                  icon={<Fingerprint size={14} />}
                  onClick={() => trackSigner(targetAddress)}
                  disabled={!isAddressLike(targetAddress)}
                >
                  track
                </Button>
                <Button
                  variant="primary"
                  icon={<Radio size={14} />}
                  onClick={loadTimeline}
                  loading={isLoading}
                  disabled={!contractReady}
                >
                  {isLoading ? "scanning…" : "scan"}
                </Button>
              </div>
            </div>

            <div className="tracked-strip" aria-label="Tracked signers">
              <span className="tracked-strip__label">
                tracking {trackedSigners.length}
              </span>
              {trackedSigners.length ? (
                trackedSigners.map((signer) => (
                  <button
                    type="button"
                    className="tracked-pill"
                    key={signer}
                    onClick={() => forgetSigner(signer)}
                    title="Stop tracking signer"
                  >
                    {shorten(signer)} ×
                  </button>
                ))
              ) : (
                <span className="tracked-strip__empty">
                  Track signers from the wire or by address.
                </span>
              )}
            </div>

            {isPreviewTimeline ? (
              <p className="receive__note">
                Showing sample posts. Set a contract address, choose a start
                block, then press <kbd>scan</kbd> to load real posts.
              </p>
            ) : null}

            {!isPreviewTimeline && shownTimeline.length === 0 ? (
              <EmptyState
                title="No posts found"
                hint="Try lowering the start block, removing the author filter, or double-checking the contract address."
              />
            ) : null}

            <div className="feed" role="list">
              {isLoading
                ? Array.from({ length: 3 }).map((_, i) => (
                    <FeedSkeleton key={i} />
                  ))
                : shownTimeline.map((item) => (
                    <FeedRow
                      key={item.id}
                      item={item}
                      explorer={network.explorer}
                      isTracked={trackedSet.has(item.author.toLowerCase())}
                      onTrack={trackSigner}
                      onForget={forgetSigner}
                    />
                  ))}
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
                    setNetworkKey(next);
                    setRpcUrl(NETWORKS[next].rpcUrl);
                    setHasQueriedTimeline(false);
                    setTimeline([]);
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
                onChange={(event) =>
                  setContractsByNetwork((current) => ({
                    ...current,
                    [networkKey]: event.target.value,
                  }))
                }
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
                    onChange={(event) => setRpcUrl(event.target.value)}
                  />
                </Field>
              </div>
            </details>

            <Field
              label="message"
              hint={`${postBytes}/${MAX_POST_BYTES} bytes — original Twitter-length cap`}
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
              hint="Optional. PNG, JPG, GIF, or WebP under 1 MB; uploaded before the post is signed."
              optional
            >
              <div className="image-upload">
                <label className="image-upload__drop">
                  <ImagePlus size={16} aria-hidden="true" />
                  <span>
                    {imageFile
                      ? `${imageFile.name} · ${Math.ceil(imageFile.size / 1024)} KB`
                      : "choose image"}
                  </span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
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

            <div className="actions">
              <Button
                variant="primary"
                icon={<Send size={14} />}
                onClick={publishPost}
                loading={isPosting || isUploadingImage}
                disabled={!contractReady}
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
                loading={isSealingId}
                disabled={!contractReady}
                block
              >
                {isSealingId ? "saving…" : "save identity"}
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
                tag="NO FUNDS"
                title="The contract holds no funds"
                body="There is no balance, no pool, and no withdraw function. Nothing to drain."
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
                title="Everything is on-chain and readable"
                body="Every post is a public event with a content hash. Anyone can read or audit the full history without trusting this app."
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

function FeedRow({
  item,
  explorer,
  isTracked,
  onTrack,
  onForget,
}: {
  item: TimelineItem;
  explorer: string;
  isTracked: boolean;
  onTrack: (address: string) => void;
  onForget: (address: string) => void;
}) {
  return (
    <article className="feed-row" role="listitem">
      <div className="feed-row__meta">
        <time className="feed-row__time" title={formatTime(item.createdAt)}>
          T-{formatRelative(item.createdAt)}
        </time>
        <span className="feed-row__idx">#{item.index.toString()}</span>
      </div>
      <p className="feed-row__text">{item.text}</p>
      {item.imageUri ? (
        <a
          className="feed-row__image"
          href={imageUriToGateway(item.imageUri)}
          target="_blank"
          rel="noreferrer"
        >
          <img
            src={imageUriToGateway(item.imageUri)}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        </a>
      ) : null}
      <div className="feed-row__foot">
        <span className="feed-row__label">from</span>
        <Hex
          value={item.author}
          href={`${explorer}/address/${item.author}`}
          label="author"
        />
        <button
          type="button"
          className="feed-row__track"
          onClick={() => (isTracked ? onForget(item.author) : onTrack(item.author))}
        >
          {isTracked ? "tracked" : "track"}
        </button>
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
        {item.imageHash &&
        item.imageHash !==
          "0x0000000000000000000000000000000000000000000000000000000000000000" ? (
          <>
            <span className="feed-row__sep" aria-hidden="true">
              ░
            </span>
            <span className="feed-row__label">img</span>
            <span className="feed-row__crc">{shortHash(item.imageHash)}</span>
          </>
        ) : null}
      </div>
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

function formatEthShort(value: string) {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  if (n === 0) return "0.0000";
  if (n < 0.0001) return n.toExponential(2);
  if (n < 1) return n.toFixed(5);
  if (n < 1000) return n.toFixed(4);
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
