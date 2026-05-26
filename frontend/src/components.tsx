// Design-system primitives for the Base command-deck UI.
// Kept dependency-free (lucide icons + ethers utils only) and styled via styles.css.

import React, { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { JsonRpcProvider, formatEther, formatUnits } from "ethers";
import type { StatusTone } from "./chain";

/* -----------------------------------------------------------------------------
 * Panel — NFO/BBS-style framed module with header label, meta tag, status dot.
 * -------------------------------------------------------------------------- */

export function Panel({
  label,
  meta,
  tone = "idle",
  actions,
  children,
  className = "",
  dense = false,
  pending = false,
  flashKey,
  id,
}: {
  label: string;
  meta?: string;
  tone?: StatusTone;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  dense?: boolean;
  /** Continuous amber border pulse while a tx is in-flight. */
  pending?: boolean;
  /** Bump this number to fire a one-shot green confirmation flash. */
  flashKey?: number;
  id?: string;
}) {
  const [flashing, setFlashing] = useState(false);
  useEffect(() => {
    if (!flashKey) return;
    setFlashing(true);
    const id = window.setTimeout(() => setFlashing(false), 1400);
    return () => window.clearTimeout(id);
  }, [flashKey]);

  return (
    <section
      id={id}
      className={[
        "panel",
        dense ? "panel--dense" : "",
        pending ? "panel--pending" : "",
        flashing ? "panel--flash" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <header className="panel__hdr">
        <span className="panel__tag">
          <StatusDot tone={tone} />
          <span className="panel__label">{label}</span>
        </span>
        <span className="panel__rule" aria-hidden="true" />
        {meta ? <span className="panel__meta">{meta}</span> : null}
        {actions ? <span className="panel__actions">{actions}</span> : null}
      </header>
      <div className="panel__body">{children}</div>
    </section>
  );
}

/* -----------------------------------------------------------------------------
 * StatusDot — 6px LED. Accessible label is set by parent context.
 * -------------------------------------------------------------------------- */

export function StatusDot({
  tone = "idle",
  pulse = false,
}: {
  tone?: StatusTone;
  pulse?: boolean;
}) {
  return (
    <span
      className={`dot dot--${tone} ${pulse ? "dot--pulse" : ""}`.trim()}
      aria-hidden="true"
    />
  );
}

/* -----------------------------------------------------------------------------
 * StatusBadge — full pill with tone + text. Replaces old .status-pill.
 * -------------------------------------------------------------------------- */

export function StatusBadge({
  tone,
  text,
}: {
  tone: StatusTone;
  text: string;
}) {
  return (
    <span className={`badge badge--${tone}`} role="status">
      <StatusDot tone={tone} pulse={tone === "good" || tone === "idle"} />
      <span>{text}</span>
    </span>
  );
}

/* -----------------------------------------------------------------------------
 * Button — primary / ghost / danger / link variants.
 * -------------------------------------------------------------------------- */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger" | "tonal";
  block?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "ghost",
      block = false,
      loading = false,
      icon,
      children,
      className = "",
      disabled,
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type="button"
        className={`btn btn--${variant} ${block ? "btn--block" : ""} ${
          loading ? "btn--loading" : ""
        } ${className}`.trim()}
        disabled={disabled || loading}
        {...rest}
      >
        {icon ? <span className="btn__icon">{icon}</span> : null}
        <span className="btn__label">{children}</span>
        {loading ? <span className="btn__spin" aria-hidden="true" /> : null}
      </button>
    );
  },
);

/* -----------------------------------------------------------------------------
 * Field — labeled input wrapper with prompt prefix.
 * -------------------------------------------------------------------------- */

type CommonFieldProps = {
  label: string;
  hint?: string;
  prefix?: string;
  error?: string;
  optional?: boolean;
};

export function Field({
  label,
  hint,
  prefix = ">",
  error,
  optional,
  children,
}: CommonFieldProps & { children: React.ReactNode }) {
  return (
    <label className={`field ${error ? "field--error" : ""}`.trim()}>
      <span className="field__label">
        <span className="field__prefix" aria-hidden="true">
          {prefix}
        </span>
        {label}
        {optional ? <em className="field__optional">opt</em> : null}
      </span>
      {children}
      {hint && !error ? <span className="field__hint">{hint}</span> : null}
      {error ? <span className="field__error">! {error}</span> : null}
    </label>
  );
}

export const Input = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input(props, ref) {
  return <input ref={ref} className="input" spellCheck={false} {...props} />;
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea(props, ref) {
  return <textarea ref={ref} className="input input--area" {...props} />;
});

export const Select = forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select(props, ref) {
  return <select ref={ref} className="input input--select" {...props} />;
});

/* -----------------------------------------------------------------------------
 * KV — key/value row with dotted leader. NFO-style metadata.
 * -------------------------------------------------------------------------- */

export function KV({
  k,
  v,
  mono = true,
  tone,
}: {
  k: React.ReactNode;
  v: React.ReactNode;
  mono?: boolean;
  tone?: StatusTone;
}) {
  return (
    <div className={`kv ${tone ? `kv--${tone}` : ""}`.trim()}>
      <span className="kv__k">{k}</span>
      <span className="kv__dots" aria-hidden="true" />
      <span className={`kv__v ${mono ? "kv__v--mono" : ""}`.trim()}>{v}</span>
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * Hex — formatted address/hash with click-to-copy.
 * -------------------------------------------------------------------------- */

export function Hex({
  value,
  href,
  truncate = true,
  label,
}: {
  value: string;
  href?: string;
  truncate?: boolean;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const display = truncate ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
  const copy = async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  };
  return (
    <span className="hex" title={label ? `${label}: ${value}` : value}>
      {href ? (
        <a className="hex__link" href={href} target="_blank" rel="noreferrer">
          <span>{display}</span>
          <ExternalLink size={11} aria-hidden="true" />
        </a>
      ) : (
        <span className="hex__text">{display}</span>
      )}
      <button
        type="button"
        className="hex__copy"
        onClick={copy}
        aria-label={`Copy ${label ?? "value"}`}
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
      </button>
    </span>
  );
}

/* -----------------------------------------------------------------------------
 * LogStream — terminal-style scrolling log lines.
 * -------------------------------------------------------------------------- */

export type LogLine = {
  id: string;
  ts: number;
  tone: StatusTone;
  text: string;
  tag?: string;
};

export function LogStream({
  lines,
  empty = "no events",
  height = 168,
}: {
  lines: LogLine[];
  empty?: string;
  height?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines]);
  return (
    <div
      ref={wrapRef}
      className="logstream"
      style={{ maxHeight: height }}
      role="log"
      aria-live="polite"
    >
      {lines.length === 0 ? (
        <div className="logstream__empty">~ {empty} ~</div>
      ) : (
        lines.map((line) => (
          <div
            key={line.id}
            className={`logstream__row logstream__row--${line.tone}`}
          >
            <time>{formatLogTime(line.ts)}</time>
            <span className="logstream__tag">{line.tag ?? "sys"}</span>
            <span className="logstream__text">{line.text}</span>
          </div>
        ))
      )}
    </div>
  );
}

function formatLogTime(ts: number) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

/* -----------------------------------------------------------------------------
 * Skeleton — loading shimmer block.
 * -------------------------------------------------------------------------- */

export function Skeleton({
  w = "100%",
  h = 14,
}: {
  w?: string | number;
  h?: number;
}) {
  return <span className="skeleton" style={{ width: w, height: h }} />;
}

/* -----------------------------------------------------------------------------
 * AsciiDivider — labeled rule, e.g. ── BLOCK 0x14A34 ───────────
 * -------------------------------------------------------------------------- */

export function AsciiDivider({ label }: { label?: string }) {
  return (
    <div className="ascii-rule" role="separator">
      <span className="ascii-rule__line" aria-hidden="true" />
      {label ? <span className="ascii-rule__label">{label}</span> : null}
      <span className="ascii-rule__line" aria-hidden="true" />
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * BootCursor — terminal cursor.
 * -------------------------------------------------------------------------- */

export function BootCursor() {
  return (
    <span className="cursor" aria-hidden="true">
      █
    </span>
  );
}

/* -----------------------------------------------------------------------------
 * useTypewriter — gradually reveal a string.
 * -------------------------------------------------------------------------- */

export function useTypewriter(text: string, speed = 18) {
  const [out, setOut] = useState("");
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setOut(text);
      return;
    }
    setOut("");
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setOut(text.slice(0, i));
      if (i >= text.length) window.clearInterval(id);
    }, speed);
    return () => window.clearInterval(id);
  }, [text, speed]);
  return out;
}

/* -----------------------------------------------------------------------------
 * useChainTelemetry — live block height + gas from the user's RPC.
 * Falls back gracefully if RPC is unreachable; never injects fake numbers.
 * -------------------------------------------------------------------------- */

export type ChainTelemetry = {
  blockNumber: number | null;
  gasGwei: number | null;
  chainId: bigint | null;
  rttMs: number | null;
  online: boolean;
  loading: boolean;
};

export function useChainTelemetry(rpcUrl: string, chainId: bigint) {
  const [state, setState] = useState<ChainTelemetry>({
    blockNumber: null,
    gasGwei: null,
    chainId: null,
    rttMs: null,
    online: false,
    loading: true,
  });

  const provider = useMemo(() => {
    if (!rpcUrl) return null;
    try {
      return new JsonRpcProvider(rpcUrl, Number(chainId));
    } catch {
      return null;
    }
  }, [rpcUrl, chainId]);

  useEffect(() => {
    if (!provider) {
      setState((s) => ({ ...s, online: false, loading: false }));
      return;
    }
    let cancelled = false;
    const tick = async () => {
      const start = performance.now();
      try {
        const [bn, fees, net] = await Promise.all([
          provider.getBlockNumber(),
          provider.getFeeData(),
          provider.getNetwork(),
        ]);
        if (cancelled) return;
        const gp = fees.gasPrice ?? fees.maxFeePerGas ?? null;
        setState({
          blockNumber: bn,
          gasGwei: gp ? Number(formatUnits(gp, "gwei")) : null,
          chainId: net.chainId,
          rttMs: Math.round(performance.now() - start),
          online: true,
          loading: false,
        });
      } catch {
        if (cancelled) return;
        setState((s) => ({ ...s, online: false, loading: false }));
      }
    };
    tick();
    const id = window.setInterval(tick, 12_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [provider]);

  return state;
}

/* -----------------------------------------------------------------------------
 * useBalance — native balance for an address.
 * -------------------------------------------------------------------------- */

export function useBalance(
  rpcUrl: string,
  chainId: bigint,
  address: string,
  refreshKey = 0,
) {
  const [balance, setBalance] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address || !rpcUrl) {
      setBalance(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const run = async () => {
      try {
        const provider = new JsonRpcProvider(rpcUrl, Number(chainId));
        const wei = await provider.getBalance(address);
        if (!cancelled) setBalance(formatEther(wei));
      } catch {
        if (!cancelled) setBalance(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [rpcUrl, chainId, address, refreshKey]);

  return { balance, loading };
}

/* -----------------------------------------------------------------------------
 * FiberBackdrop — CSS+SVG dark-fiber / packet-flow backdrop. No three.js.
 * Decorative only; aria-hidden.
 * -------------------------------------------------------------------------- */

export function FiberBackdrop() {
  return (
    <div className="fiber" aria-hidden="true">
      <svg
        className="fiber__svg"
        viewBox="0 0 1600 900"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <radialGradient id="fiber-glow" cx="50%" cy="50%" r="60%">
            <stop offset="0%" stopColor="rgba(33, 81, 245, 0.22)" />
            <stop offset="60%" stopColor="rgba(33, 81, 245, 0.04)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0)" />
          </radialGradient>
          <linearGradient id="fiber-line" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="rgba(46, 230, 255, 0)" />
            <stop offset="50%" stopColor="rgba(46, 230, 255, 0.55)" />
            <stop offset="100%" stopColor="rgba(46, 230, 255, 0)" />
          </linearGradient>
        </defs>
        <rect width="1600" height="900" fill="url(#fiber-glow)" />
        {/* horizontal trunk lines */}
        {[120, 240, 360, 480, 600, 720, 840].map((y, i) => (
          <line
            key={y}
            x1="0"
            x2="1600"
            y1={y}
            y2={y}
            stroke="rgba(120, 165, 220, 0.08)"
            strokeWidth={1}
            strokeDasharray={i % 2 === 0 ? "1 7" : "1 3"}
          />
        ))}
        {/* vertical risers */}
        {[160, 380, 620, 920, 1200, 1440].map((x) => (
          <line
            key={x}
            x1={x}
            x2={x}
            y1="0"
            y2="900"
            stroke="rgba(120, 165, 220, 0.06)"
            strokeWidth={1}
            strokeDasharray="2 9"
          />
        ))}
        {/* sweeping packet */}
        <line
          className="fiber__packet"
          x1="0"
          x2="320"
          y1="360"
          y2="360"
          stroke="url(#fiber-line)"
          strokeWidth="1.5"
        />
        <line
          className="fiber__packet fiber__packet--b"
          x1="0"
          x2="240"
          y1="600"
          y2="600"
          stroke="url(#fiber-line)"
          strokeWidth="1"
        />
      </svg>
    </div>
  );
}
