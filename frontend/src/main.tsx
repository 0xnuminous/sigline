import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  BadgeCheck,
  CircleSlash,
  ExternalLink,
  Eye,
  Gauge,
  Radio,
  Send,
  ShieldCheck,
  Sparkles,
  Wallet,
} from "lucide-react";
import {
  BrowserProvider,
  Contract,
  EventLog,
  JsonRpcProvider,
  getAddress,
  isAddress,
} from "ethers";
import * as THREE from "three";
import "./styles.css";

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on?: (event: string, callback: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, callback: (...args: unknown[]) => void) => void;
    };
  }
}

type NetworkKey = "base-sepolia" | "base";

type NetworkConfig = {
  key: NetworkKey;
  label: string;
  chainId: bigint;
  chainHex: string;
  rpcUrl: string;
  explorer: string;
  currency: string;
};

type TimelineItem = {
  id: string;
  author: string;
  index: bigint;
  createdAt: number;
  contentHash: string;
  text: string;
  txHash: string;
  blockNumber: number;
};

type StatusTone = "idle" | "good" | "warn" | "bad";
type ContractMap = Record<NetworkKey, string>;

const NETWORKS: Record<NetworkKey, NetworkConfig> = {
  "base-sepolia": {
    key: "base-sepolia",
    label: "Base Sepolia",
    chainId: 84532n,
    chainHex: "0x14a34",
    rpcUrl: "https://sepolia.base.org",
    explorer: "https://sepolia-explorer.base.org",
    currency: "ETH",
  },
  base: {
    key: "base",
    label: "Base Mainnet",
    chainId: 8453n,
    chainHex: "0x2105",
    rpcUrl: "https://mainnet.base.org",
    explorer: "https://base.blockscout.com",
    currency: "ETH",
  },
};

const ABI = [
  "function post(string text) returns (uint256 index, bytes32 contentHash)",
  "function setProfile(string nick, string twtUrl)",
  "function profile(address account) view returns (tuple(string nick, string twtUrl, uint64 updatedAt))",
  "function postCount(address account) view returns (uint256)",
  "event TweetPosted(address indexed author, uint256 indexed index, uint64 indexed createdAt, bytes32 contentHash, string text)",
  "event ProfileUpdated(address indexed account, string nick, string twtUrl, uint64 updatedAt)",
];

const DEFAULT_NETWORK = (import.meta.env.VITE_BASE_NETWORK === "base" ? "base" : "base-sepolia") as NetworkKey;
const DEFAULT_CONTRACT = import.meta.env.VITE_BASE_TWTXT_CONTRACT ?? "";
const DEFAULT_RPC = import.meta.env.VITE_BASE_RPC_URL ?? NETWORKS[DEFAULT_NETWORK].rpcUrl;
const DEFAULT_FROM_BLOCK = import.meta.env.VITE_BASE_FROM_BLOCK ?? "0";
const STORAGE_KEY = "basetwtxt.frontend.v1";

const samplePosts: TimelineItem[] = [
  {
    id: "sample-1",
    author: "0x8fC6e1D2f21Bb22B1013D05ecF1F06fD73CdCB34",
    index: 2n,
    createdAt: Math.floor(Date.now() / 1000) - 420,
    contentHash: "0x58c7f3f1e5cf51e2a3bb5f219b8fd32b3e91e50c092116b12dd58f7d3a410001",
    text: "green channel open. receipt sealed.",
    txHash: "0x8b1db7fdcbfc7f18d46db47f36c8cfcf5d50e78f1a2ce3995c28198f54a01001",
    blockNumber: 1842041,
  },
  {
    id: "sample-2",
    author: "0xaB7C8803962c0f2F5BBBe3FA8bf41cd82AA1923C",
    index: 0n,
    createdAt: Math.floor(Date.now() / 1000) - 2580,
    contentHash: "0xc0ffee0000000000000000000000000000000000000000000000000000000001",
    text: "small feed. hard proof. no middleman.",
    txHash: "0x9f1db7fdcbfc7f18d46db47f36c8cfcf5d50e78f1a2ce3995c28198f54a01002",
    blockNumber: 1841130,
  },
];

function App() {
  const saved = readSavedSettings();
  const [networkKey, setNetworkKey] = useState<NetworkKey>(saved.networkKey);
  const network = NETWORKS[networkKey];
  const [contractsByNetwork, setContractsByNetwork] = useState<ContractMap>(saved.contractsByNetwork);
  const contractAddress = contractsByNetwork[networkKey];
  const [rpcUrl, setRpcUrl] = useState(saved.rpcUrl);
  const [fromBlock, setFromBlock] = useState(saved.fromBlock);
  const [account, setAccount] = useState("");
  const [walletChain, setWalletChain] = useState<bigint | null>(null);
  const [status, setStatus] = useState<{ tone: StatusTone; text: string }>({
    tone: "idle",
    text: "Signal ready on Base Sepolia",
  });
  const [postText, setPostText] = useState("green signal, permanent proof.");
  const [nick, setNick] = useState("cipher");
  const [twtUrl, setTwtUrl] = useState("https://example.org/twtxt.txt");
  const [targetAddress, setTargetAddress] = useState("");
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [hasQueriedTimeline, setHasQueriedTimeline] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const [lastTx, setLastTx] = useState("");

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ networkKey, contractsByNetwork, rpcUrl, fromBlock })
    );
  }, [networkKey, contractsByNetwork, rpcUrl, fromBlock]);

  useEffect(() => {
    setRpcUrl((current) => current || NETWORKS[networkKey].rpcUrl);
  }, [networkKey]);

  useEffect(() => {
    const handleAccounts = (accounts: unknown) => {
      if (Array.isArray(accounts) && typeof accounts[0] === "string") {
        setAccount(accounts[0]);
        setTargetAddress((current) => current || accounts[0]);
      } else {
        setAccount("");
        setTargetAddress("");
        setWalletChain(null);
      }
    };
    const handleChain = (chainId: unknown) => {
      if (typeof chainId === "string") {
        setWalletChain(BigInt(chainId));
      }
    };
    window.ethereum?.on?.("accountsChanged", handleAccounts);
    window.ethereum?.on?.("chainChanged", handleChain);
    return () => {
      window.ethereum?.removeListener?.("accountsChanged", handleAccounts);
      window.ethereum?.removeListener?.("chainChanged", handleChain);
    };
  }, []);

  const contractReady = useMemo(() => isAddress(contractAddress), [contractAddress]);
  const chainAligned = walletChain === null || walletChain === network.chainId;
  const isPreviewTimeline = !hasQueriedTimeline && timeline.length === 0;
  const shownTimeline = isPreviewTimeline ? samplePosts : timeline;

  const connectWallet = useCallback(async () => {
    if (!window.ethereum) {
      setStatus({ tone: "bad", text: "No wallet detected" });
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
      setStatus({ tone: "good", text: "Signer linked" });
    } catch (error) {
      setStatus({ tone: "bad", text: getDisplayErrorMessage(error) });
    }
  }, []);

  const switchNetwork = useCallback(async () => {
    if (!window.ethereum) {
      setStatus({ tone: "bad", text: "No wallet detected" });
      return;
    }
    try {
      await switchOrAddNetwork(network);
      setWalletChain(network.chainId);
      setStatus({ tone: "good", text: `Signer routed to ${network.label}` });
    } catch (error) {
      setStatus({ tone: "bad", text: getDisplayErrorMessage(error) });
    }
  }, [network]);

  const publishPost = useCallback(async () => {
    if (!contractReady) {
      setStatus({ tone: "warn", text: "Paste a live registry address" });
      return;
    }
    if (!postText.trim()) {
      setStatus({ tone: "warn", text: "Signal text is empty" });
      return;
    }
    try {
      setIsPosting(true);
      await ensureWalletOnNetwork(network);
      const contract = await writableContract(contractAddress, network);
      const tx = await contract.post(postText.trim());
      setStatus({ tone: "idle", text: "Signal submitted" });
      const receipt = await tx.wait();
      setLastTx(receipt.hash);
      setStatus({ tone: "good", text: "Signal sealed" });
      await loadTimeline();
    } catch (error) {
      setStatus({ tone: "bad", text: getDisplayErrorMessage(error) });
    } finally {
      setIsPosting(false);
    }
  }, [contractAddress, contractReady, network, postText]);

  const publishProfile = useCallback(async () => {
    if (!contractReady) {
      setStatus({ tone: "warn", text: "Paste a live registry address" });
      return;
    }
    if (!nick.trim()) {
      setStatus({ tone: "warn", text: "Alias is empty" });
      return;
    }
    try {
      setIsPosting(true);
      await ensureWalletOnNetwork(network);
      const contract = await writableContract(contractAddress, network);
      const tx = await contract.setProfile(nick.trim(), twtUrl.trim());
      setStatus({ tone: "idle", text: "Identity submitted" });
      const receipt = await tx.wait();
      setLastTx(receipt.hash);
      setStatus({ tone: "good", text: "Identity sealed" });
    } catch (error) {
      setStatus({ tone: "bad", text: getDisplayErrorMessage(error) });
    } finally {
      setIsPosting(false);
    }
  }, [contractAddress, contractReady, network, nick, twtUrl]);

  const loadTimeline = useCallback(async () => {
    if (!contractReady) {
      setStatus({ tone: "warn", text: "Paste a live registry address" });
      return;
    }
    const normalizedTarget = targetAddress.trim();
    if (normalizedTarget && !isAddress(normalizedTarget)) {
      setStatus({ tone: "warn", text: "Author address is invalid" });
      return;
    }
    try {
      setIsLoading(true);
      const provider = new JsonRpcProvider(rpcUrl || network.rpcUrl, Number(network.chainId));
      await assertContractDeployed(provider, contractAddress);
      const contract = new Contract(contractAddress, ABI, provider);
      const startBlock = parseBlock(fromBlock);
      const filter = normalizedTarget
        ? contract.filters.TweetPosted(getAddress(normalizedTarget))
        : contract.filters.TweetPosted();
      const events = await contract.queryFilter(filter, startBlock, "latest");
      const parsed = events
        .filter((event): event is EventLog => event instanceof EventLog)
        .map((event) => toTimelineItem(event))
        .sort((a, b) => b.createdAt - a.createdAt || Number(b.index - a.index));
      setTimeline(parsed.slice(0, 40));
      setHasQueriedTimeline(true);
      setStatus({
        tone: parsed.length ? "good" : "idle",
        text: parsed.length ? `${parsed.length} signals loaded` : "No signals found",
      });
    } catch (error) {
      setStatus({ tone: "bad", text: getDisplayErrorMessage(error) });
    } finally {
      setIsLoading(false);
    }
  }, [contractAddress, contractReady, fromBlock, network, rpcUrl, targetAddress]);

  return (
    <main>
      <section className="hero" aria-label="BaseTwtxt">
        <img
          className="hero-image"
          src="/images/hero-cypherpunk-green.png"
          alt=""
          aria-hidden="true"
          decoding="async"
        />
        <SignalField />
        <header className="topbar">
          <a className="brand-mark" href="#workspace" aria-label="BaseTwtxt terminal">
            <span>BaseTwtxt</span>
          </a>
          <nav aria-label="Primary navigation">
            <a href="#workspace">Transmit</a>
            <a href="#timeline">Receive</a>
            <a href="#security">Trust</a>
          </nav>
          <button className="icon-button wallet-button" type="button" onClick={connectWallet}>
            <Wallet size={18} aria-hidden="true" />
            <span>{account ? shorten(account) : "Connect"}</span>
          </button>
        </header>

        <div className="hero-copy">
          <p className="eyebrow">Encrypted social signal</p>
          <h1>Cypherpunk twtxt for the green channel.</h1>
          <p className="hero-line">
            A small, portable feed with public receipts, hard limits, and no custody.
          </p>
          <div className="hero-actions">
            <a className="primary-link" href="#workspace">
              Open terminal <ArrowUpRight size={18} aria-hidden="true" />
            </a>
            <a className="ghost-link" href="#security">
              Trust rules
            </a>
          </div>
        </div>
      </section>

      <section id="workspace" className="workspace section-band">
        <div className="section-label">
          <Radio size={18} aria-hidden="true" />
          <span>Transmit</span>
        </div>
        <div className="workspace-grid">
          <div className="compose-panel">
            <div className="panel-heading">
              <h2>Write the next signal.</h2>
              <StatusPill tone={status.tone} text={status.text} />
            </div>

            <div className="field-row split">
              <label>
                <span>Network</span>
                <select
                  value={networkKey}
                  onChange={(event) => {
                    const next = event.target.value as NetworkKey;
                    setNetworkKey(next);
                    setRpcUrl(NETWORKS[next].rpcUrl);
                    setHasQueriedTimeline(false);
                    setTimeline([]);
                  }}
                >
                  <option value="base-sepolia">Base Sepolia</option>
                  <option value="base">Base Mainnet</option>
                </select>
              </label>
              <label>
                <span>Start</span>
                <input value={fromBlock} onChange={(event) => setFromBlock(event.target.value)} />
              </label>
            </div>

            <label className="field-row">
              <span>Registry</span>
              <input
                value={contractAddress}
                placeholder="0x..."
                onChange={(event) =>
                  setContractsByNetwork((current) => ({ ...current, [networkKey]: event.target.value }))
                }
                spellCheck={false}
              />
            </label>

            <details className="route-settings">
              <summary>Route settings</summary>
              <label className="field-row">
                <span>Signal gateway</span>
                <input
                  value={rpcUrl}
                  placeholder={network.rpcUrl}
                  onChange={(event) => setRpcUrl(event.target.value)}
                  spellCheck={false}
                />
              </label>
            </details>

            <label className="field-row">
              <span>Signal</span>
              <textarea value={postText} onChange={(event) => setPostText(event.target.value)} maxLength={560} />
            </label>

            <div className="action-row">
              <button className="primary-button" type="button" onClick={publishPost} disabled={isPosting}>
                <Send size={18} aria-hidden="true" />
                <span>{isPosting ? "Sealing" : "Transmit"}</span>
              </button>
              <button className="secondary-button" type="button" onClick={chainAligned ? connectWallet : switchNetwork}>
                <Wallet size={18} aria-hidden="true" />
                <span>{chainAligned ? "Signer" : "Switch network"}</span>
              </button>
            </div>
          </div>

          <aside className="profile-panel">
            <div>
              <p className="eyebrow">Identity</p>
              <h3>Alias sealed by your signer.</h3>
            </div>
            <label className="field-row">
              <span>Alias</span>
              <input value={nick} onChange={(event) => setNick(event.target.value)} maxLength={64} />
            </label>
            <label className="field-row">
              <span>twtxt URL</span>
              <input value={twtUrl} onChange={(event) => setTwtUrl(event.target.value)} maxLength={512} />
            </label>
            <button className="secondary-button wide" type="button" onClick={publishProfile} disabled={isPosting}>
              <BadgeCheck size={18} aria-hidden="true" />
              <span>Seal identity</span>
            </button>
            <div className="wallet-readout">
              <span>Signer</span>
              <strong>{account ? shorten(account) : "Offline"}</strong>
            </div>
            <div className="wallet-readout">
              <span>Network ID</span>
              <strong>{walletChain ? String(walletChain) : "Offline"}</strong>
            </div>
            {lastTx ? (
              <a className="tx-link" href={`${network.explorer}/tx/${lastTx}`} target="_blank" rel="noreferrer">
                Latest receipt <ExternalLink size={15} aria-hidden="true" />
              </a>
            ) : null}
          </aside>
        </div>
      </section>

      <section id="timeline" className="timeline-section section-band">
        <div className="section-label">
          <Eye size={18} aria-hidden="true" />
          <span>Receive</span>
        </div>
        <div className="timeline-head">
          <h2>Read the public signal.</h2>
          <div className="timeline-controls">
            <input
              value={targetAddress}
              placeholder="Author 0x..."
              onChange={(event) => setTargetAddress(event.target.value)}
              spellCheck={false}
            />
            <button className="secondary-button" type="button" onClick={loadTimeline} disabled={isLoading}>
              <Gauge size={18} aria-hidden="true" />
              <span>{isLoading ? "Scanning" : "Scan"}</span>
            </button>
          </div>
        </div>
        {isPreviewTimeline ? <p className="timeline-note">Preview signals until the first scan.</p> : null}
        {!isPreviewTimeline && shownTimeline.length === 0 ? <p className="timeline-note">No signals loaded.</p> : null}
        <div className="timeline-list">
          {shownTimeline.map((item) => (
            <article className="tweet-row" key={item.id}>
              <time>{formatTime(item.createdAt)}</time>
              <p>{item.text}</p>
              <div className="tweet-meta">
                <span>{shorten(item.author)}</span>
                <span>#{item.index.toString()}</span>
                <a href={`${network.explorer}/tx/${item.txHash}`} target="_blank" rel="noreferrer">
                  receipt <ExternalLink size={13} aria-hidden="true" />
                </a>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section id="security" className="security-section section-band">
        <div className="section-label">
          <ShieldCheck size={18} aria-hidden="true" />
          <span>Trust rules</span>
        </div>
        <div className="security-grid">
          <SecurityPoint icon={<CircleSlash size={22} />} title="No custody" text="The registry cannot hold funds, so there is no balance to drain." />
          <SecurityPoint icon={<ShieldCheck size={22} />} title="Narrow control" text="Emergency control can pause writes only; handoff requires confirmation." />
          <SecurityPoint icon={<Sparkles size={22} />} title="Bounded signal" text="Signals, aliases, and twtxt links are capped before they are sealed." />
        </div>
      </section>

      <footer className="footer-cta">
        <p>Flat-file spirit. Public proof.</p>
        <a className="footer-link" href="#workspace">
          Enter terminal <ArrowUpRight size={16} aria-hidden="true" />
        </a>
      </footer>
    </main>
  );
}

function SignalField() {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return undefined;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, mount.clientWidth / mount.clientHeight, 0.1, 100);
    camera.position.set(0, 0.4, 8);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const group = new THREE.Group();
    scene.add(group);

    const torusGeometry = new THREE.TorusKnotGeometry(1.6, 0.16, 220, 18, 2, 5);
    const torusMaterial = new THREE.MeshStandardMaterial({
      color: 0x39ff14,
      roughness: 0.42,
      metalness: 0.58,
      emissive: 0x0f5f12,
      emissiveIntensity: 0.95,
    });
    const knot = new THREE.Mesh(torusGeometry, torusMaterial);
    group.add(knot);

    const lineMaterial = new THREE.LineBasicMaterial({ color: 0x8dff8d, transparent: true, opacity: 0.46 });
    const lineGeometries: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 42; i += 1) {
      const points = [];
      const radius = 2.4 + i * 0.035;
      for (let j = 0; j < 80; j += 1) {
        const angle = (j / 80) * Math.PI * 2;
        points.push(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.42, (i - 21) * 0.018));
      }
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      lineGeometries.push(geometry);
      const line = new THREE.LineLoop(geometry, lineMaterial);
      line.rotation.x = i * 0.035;
      line.rotation.y = i * 0.06;
      group.add(line);
    }

    const particleGeometry = new THREE.BufferGeometry();
    const particleCount = 900;
    const positions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i += 1) {
      positions[i * 3] = (Math.random() - 0.5) * 11;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 7;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 7;
    }
    particleGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const particles = new THREE.Points(
      particleGeometry,
      new THREE.PointsMaterial({ color: 0xcaffbf, size: 0.018, transparent: true, opacity: 0.82 })
    );
    scene.add(particles);

    scene.add(new THREE.AmbientLight(0xbaffba, 0.38));
    const acid = new THREE.PointLight(0x39ff14, 9, 18);
    acid.position.set(-3.2, 2.5, 4);
    scene.add(acid);
    const green = new THREE.PointLight(0xb7ff4a, 4, 14);
    green.position.set(3.4, -1.5, 3);
    scene.add(green);

    const pointer = { x: 0, y: 0 };
    const onPointerMove = (event: PointerEvent) => {
      const rect = mount.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
      pointer.y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
    };
    mount.addEventListener("pointermove", onPointerMove);

    const resize = () => {
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener("resize", resize);

    let frame = 0;
    let raf = 0;
    const animate = () => {
      frame += 0.01;
      group.rotation.x += (pointer.y * 0.35 - group.rotation.x) * 0.035;
      group.rotation.y += (pointer.x * 0.55 - group.rotation.y) * 0.035;
      knot.rotation.z += 0.004;
      particles.rotation.y -= 0.0009;
      particles.rotation.x = Math.sin(frame) * 0.04;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      mount.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("resize", resize);
      renderer.dispose();
      torusGeometry.dispose();
      torusMaterial.dispose();
      lineGeometries.forEach((geometry) => geometry.dispose());
      lineMaterial.dispose();
      particleGeometry.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  return <div className="signal-field" ref={mountRef} aria-hidden="true" />;
}

function StatusPill({ tone, text }: { tone: StatusTone; text: string }) {
  return <p className={`status-pill ${tone}`}>{text}</p>;
}

function SecurityPoint({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <article className="security-point">
      <span>{icon}</span>
      <h3>{title}</h3>
      <p>{text}</p>
    </article>
  );
}

async function writableContract(contractAddress: string, network: NetworkConfig) {
  if (!window.ethereum) {
    throw new Error("NO_WALLET");
  }
  const provider = new BrowserProvider(window.ethereum);
  const current = await provider.getNetwork();
  if (current.chainId !== network.chainId) {
    throw new Error("WRONG_NETWORK");
  }
  await assertContractDeployed(provider, contractAddress);
  const signer = await provider.getSigner();
  return new Contract(contractAddress, ABI, signer);
}

async function ensureWalletOnNetwork(network: NetworkConfig) {
  if (!window.ethereum) {
    throw new Error("NO_WALLET");
  }
  const provider = new BrowserProvider(window.ethereum);
  const current = await provider.getNetwork();
  if (current.chainId !== network.chainId) {
    await switchOrAddNetwork(network);
  }
}

async function switchOrAddNetwork(network: NetworkConfig) {
  if (!window.ethereum) {
    throw new Error("NO_WALLET");
  }
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: network.chainHex }],
    });
  } catch (error) {
    const maybeCode = typeof error === "object" && error && "code" in error ? Number(error.code) : 0;
    if (maybeCode !== 4902) {
      throw error;
    }
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: network.chainHex,
          chainName: network.label,
          rpcUrls: [network.rpcUrl],
          nativeCurrency: { name: "Ether", symbol: network.currency, decimals: 18 },
          blockExplorerUrls: [network.explorer],
        },
      ],
    });
  }
}

async function assertContractDeployed(provider: BrowserProvider | JsonRpcProvider, contractAddress: string) {
  const code = await provider.getCode(contractAddress);
  if (code === "0x") {
    throw new Error("REGISTRY_NOT_FOUND");
  }
}

function toTimelineItem(event: EventLog): TimelineItem {
  const args = event.args;
  return {
    id: `${event.transactionHash}-${event.index}`,
    author: String(args.author),
    index: BigInt(args.index),
    createdAt: Number(args.createdAt),
    contentHash: String(args.contentHash),
    text: String(args.text),
    txHash: event.transactionHash,
    blockNumber: event.blockNumber,
  };
}

function readSavedSettings(): {
  networkKey: NetworkKey;
  contractsByNetwork: ContractMap;
  rpcUrl: string;
  fromBlock: string;
} {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Partial<{
      networkKey: NetworkKey;
      contractAddress: string;
      contractsByNetwork: ContractMap;
      rpcUrl: string;
      fromBlock: string;
    }>;
    const networkKey = parsed.networkKey && NETWORKS[parsed.networkKey] ? parsed.networkKey : DEFAULT_NETWORK;
    const contractsByNetwork = {
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
    };
  } catch {
    return {
      networkKey: DEFAULT_NETWORK,
      contractsByNetwork: {
        "base-sepolia": DEFAULT_NETWORK === "base-sepolia" ? DEFAULT_CONTRACT : "",
        base: DEFAULT_NETWORK === "base" ? DEFAULT_CONTRACT : "",
      },
      rpcUrl: DEFAULT_RPC,
      fromBlock: DEFAULT_FROM_BLOCK,
    };
  }
}

function parseBlock(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return 0;
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("BAD_START_BLOCK");
  }
  return parsed;
}

function shorten(value: string) {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp * 1000));
}

function getDisplayErrorMessage(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? Number(error.code) : 0;
  if (code === 4001) {
    return "Request rejected in wallet";
  }
  if (error instanceof Error) {
    if (error.message === "NO_WALLET") {
      return "No wallet detected";
    }
    if (error.message === "WRONG_NETWORK") {
      return "Signer is on the wrong network";
    }
    if (error.message === "REGISTRY_NOT_FOUND") {
      return "No live registry at that address";
    }
    if (error.message === "BAD_START_BLOCK") {
      return "Start must be a non-negative block number";
    }
  }
  if (typeof error === "object" && error && "shortMessage" in error) {
    const shortMessage = String(error.shortMessage).toLowerCase();
    if (shortMessage.includes("user rejected") || shortMessage.includes("denied")) {
      return "Request rejected in wallet";
    }
    if (shortMessage.includes("insufficient funds")) {
      return "Insufficient funds for network fee";
    }
  }
  return "Request failed. Check signer, network, and registry.";
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
