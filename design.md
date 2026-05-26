# Sigline Design System

> A reference for humans and language models extending the Sigline frontend.
> Read this **before** adding screens, components, copy, or styles. The system
> is opinionated; following it is what keeps the product coherent.

---

## 0. TL;DR for models

If you are an LLM editing this codebase:

1. **Reuse, don't invent.** Compose UIs from the primitives in
   `frontend/src/components.tsx`. Do not add ad-hoc divs with inline styles
   when a `Panel`, `Field`, `Button`, `KV`, `StatusBadge`, `Hex`, `LogStream`,
   or `Skeleton` exists.
2. **Use tokens, not literals.** Refer to colors and spacing through the CSS
   variables defined in `frontend/src/styles.css` (`--ink-2`, `--phosphor`,
   `--s-4`, etc.). Never hard-code hex values or pixel values that duplicate
   a token.
3. **State has tones.** Everything that has status uses the four-tone scale:
   `idle | good | warn | bad`. Pass `tone` to `StatusDot`, `StatusBadge`, `KV`,
   `Panel`. Do not improvise new colors for new states.
4. **Write for a human user, not for the brief.** See §8 Copy Voice. Phrases
   like "deck cold", "signal sealed", "base command layer", "no custody" are
   leaked design-brief language and must not appear in UI copy.
5. **Animations communicate, never decorate.** Only the motions documented in
   §7 are allowed. All animations must respect `prefers-reduced-motion`.
6. **Don't break the chain layer.** `frontend/src/chain.ts` owns network configs,
   ABI, contract helpers, and error mapping. Add new chain logic there, not in
   components.

---

## 1. Identity

Sigline is a **command-deck for Base**: a small public microblog where each
post is an event on a Base smart contract. The interface should feel like a
tactical operator's console — dense, technical, legible, sovereign — but built
to a real product bar (not hacker cosplay).

**Inspirations** (atmosphere only, never copied):

- Phosphor CRT terminals, BBS boards, 90s NFO release files
- Packet sniffers, command-line dashboards, encrypted comms
- Dark fiber maps, cyberdeck rigs
- Underground crypto-anarchist zines

**Adjectives that should always be true of the UI:** technical, legible, fast,
sovereign, high-signal, nocturnal, low-trust by default.

---

## 2. Anti-patterns — never ship these

| ❌ Don't | ✅ Do instead |
|---|---|
| Generic Web3 purple gradients | Near-black surfaces + restrained Base blue |
| Neon casino glow on every element | Glow only on `good`/`pending`/`bad` state changes |
| Giant marketing display headlines | Compact monospace HUDs + sans-serif sentences |
| Cosplay terminal copy ("deck cold", "signer dropped", "tx.sealed") | Plain English that tells a user what happened |
| Brief-language slogans ("base command layer", "no custody", "green channel") | Concrete product sentences |
| Cartoon hacker tropes (skulls, hooded figures, Matrix code rain) | Real telemetry: block height, gas, RTT |
| Fake data masquerading as live data | Real RPC reads, or clear empty/loading states |
| Inline hex colors / px values that duplicate tokens | `var(--…)` tokens, `var(--s-N)` spacing |
| Decorative animations that fire on render | Animations only on real state changes |
| Heavy 3D / WebGL for ambient backdrops | CSS + SVG, or nothing |
| New dependencies for problems CSS solves | Stick to `ethers`, `lucide-react`, `react` |

---

## 3. Color tokens

All colors live in `:root` in `frontend/src/styles.css`. **Reference them by
name, never by hex.**

### 3.1 Surfaces (near-black, cool)

| Token | Hex | Use |
|---|---|---|
| `--ink-0` | `#000204` | Deepest void — log streams, ASCII frames |
| `--ink-1` | `#04070b` | Page background |
| `--ink-2` | `#070c14` | Panel body base |
| `--ink-3` | `#0b1322` | Hover / raised surfaces, buttons |
| `--ink-4` | `#11192a` | Input fields |

### 3.2 Lines

| Token | Use |
|---|---|
| `--line` | Default 1px borders, dotted dividers |
| `--line-strong` | Hover state, prominent borders, button outlines |
| `--line-hot` | Reserved for cyan focus emphasis |

### 3.3 Text

| Token | Use |
|---|---|
| `--text-hot` | Primary headings, values, focused text |
| `--text` | Body text |
| `--text-dim` | Secondary text, hints, descriptions |
| `--text-faint` | Tertiary, metadata, disabled, dotted-leader keys |

### 3.4 Accents (use sparingly, with intent)

| Token | Hex | Meaning | Where it appears |
|---|---|---|---|
| `--base` | `#2151f5` | Base chain identity | Primary buttons, hero glow |
| `--base-glow` | `#4c7dff` | Primary button hover | – |
| `--phosphor` | `#45ff8f` | **Success / confirmed / good** | Confirmation flash, good badges, sealed feed timestamps |
| `--cyan` | `#2ee6ff` | **Active / interactive / idle** | Focus rings, links, status dots at rest, panel labels |
| `--magenta` | `#c850b5` | Reserved illicit — empty states, ASCII art only | `no carrier` block |
| `--amber` | `#ffb547` | **Warning / pending / in-flight** | Pending pulse, warn badges, busy wallet |
| `--danger` | `#ff5577` | **Error / refused / unreachable** | Bad badges, error text, offline RPC |

### 3.5 The tone scale (canonical)

Every status uses exactly four tones. Components accept `tone?: StatusTone`:

```ts
type StatusTone = "idle" | "good" | "warn" | "bad";
```

| Tone | Color var | When |
|---|---|---|
| `idle` | `--cyan` | At rest, neutral, no action required |
| `good` | `--phosphor` | Connected, confirmed, online, success |
| `warn` | `--amber` | Pending, misaligned, needs attention |
| `bad` | `--danger` | Failed, rejected, unreachable |

**Never invent a fifth tone.** If a new state appears, map it onto one of these.

---

## 4. Typography

Two stacks, declared as CSS variables:

```css
--mono: "JetBrains Mono", "Berkeley Mono", "SF Mono", "SFMono-Regular",
        "IBM Plex Mono", "Cascadia Mono", Menlo, Consolas, ui-monospace, monospace;
--sans: "Inter", "SF Pro Text", "Segoe UI", -apple-system, BlinkMacSystemFont,
        system-ui, sans-serif;
```

### When to use which

| Use case | Stack |
|---|---|
| Default body / data / chrome | `--mono` |
| Tags, labels, HUD, log streams, key-value tables | `--mono` |
| Addresses, hashes, block numbers, gas | `--mono` (with `font-variant-numeric: tabular-nums`) |
| Long-form copy: feed posts, trust-matrix bodies, hero lede | `--sans` |
| Hero h1 sentence | `--sans` |
| `Panel__label` (panel name tag) | `--mono`, uppercase, letter-spacing 0.16em |

**Rule of thumb:** if a human is reading a sentence, sans. If a human is
scanning data, mono.

### Size scale (no separate token — declared per component)

| Role | Size |
|---|---|
| HUD chips, NFO tags, kv keys | `10–11 px` uppercase tracked `0.14–0.18em` |
| Body | `12.5–13 px` |
| Hints, footers | `10.5–11.5 px` |
| Feed post text, trust body, lede | `13.5–16 px` sans, line-height 1.5–1.6 |
| Hero h1 | `clamp(28px, 4.4vw, 52px)` sans |
| ASCII title block | `clamp(6px, 1vw, 11px)` mono |

---

## 5. Spacing

8-point scale exposed as variables. **Use these.**

| Token | Value | Typical use |
|---|---|---|
| `--s-1` | `4px` | Icon gaps, tight kv leaders |
| `--s-2` | `8px` | Inline element gaps, badge padding |
| `--s-3` | `12px` | Panel header padding, row gaps |
| `--s-4` | `16px` | Panel body padding, form gaps |
| `--s-5` | `24px` | Panel body padding (default) |
| `--s-6` | `32px` | Section spacing |
| `--s-7` | `48px` | Reserved |

### Layout shell

- Outer page: max-width `1440px`, gutters `clamp(16px, 3vw, 28px)`.
- Sticky topbar at `top: 0`, sticky status bar at `bottom: 0`, content scrolls between.
- The main grid uses CSS Grid `grid-template-areas` for the two-column "TRANSMIT / RIG-IDENTITY-LOG" arrangement, collapses to single column under 1100 px.

---

## 6. Components (`frontend/src/components.tsx`)

Every primitive accepts standard React props (className passthrough where it
makes sense) and uses tokens internally. **Use these first.** Reach for raw
HTML only when no primitive fits.

### 6.1 `<Panel>` — the dominant container

```tsx
<Panel
  label="TRANSMIT"            // uppercase short name, required
  meta="Write a post"         // sentence-case sublabel, optional
  tone="good"                 // resting tone, default "idle"
  pending={isPosting}         // amber border pulse during tx
  flashKey={postFlash}        // bump to fire phosphor confirmation flash
  actions={<StatusBadge…/>}   // top-right inline content
  dense={false}               // tighter padding for log-style panels
  id="transmit"
>
  …body…
</Panel>
```

| Prop | Effect |
|---|---|
| `pending` | Continuous 1.6 s amber border + header pulse. Set true while awaiting a tx receipt or scan. |
| `flashKey` | Bump (e.g. `setFlash(n=>n+1)`) after a successful confirmation to fire a 1.4 s one-shot phosphor border flash. |

**Always wrap modules in `<Panel>`.** Do not create a custom card.

### 6.2 `<Button>`

```tsx
<Button
  variant="primary"           // primary | ghost | tonal | danger; default ghost
  icon={<Send size={14} />}
  onClick={…}
  loading={isPosting}         // shows spinner; auto-disables
  disabled={!ready}
  block                       // full-width
>
  post
</Button>
```

Variants:

| Variant | Visual | Use |
|---|---|---|
| `primary` | Base-blue fill | One per panel — the dominant action |
| `ghost` | Outlined | Secondary actions ("switch wallet", "switch network") |
| `tonal` | Cyan-tinted | Tertiary actions ("refresh balance") |
| `danger` | Red-tinted outline | Destructive actions (none currently) |

**Button labels:** lowercase verb phrases ("post", "scan", "connect wallet",
"save identity"). Never sentence-case, never imperative caps.

### 6.3 `<Field>` + `<Input>` / `<Textarea>` / `<Select>`

```tsx
<Field
  label="contract address"
  hint="The Sigline registry contract on this network"
  error={contractAddress && !valid ? "That doesn't look like a valid address" : undefined}
  optional
>
  <Input value={…} onChange={…} placeholder="0x…" />
</Field>
```

- **Labels:** lowercase, single concept ("alias", "message", "rpc url").
- **Hints:** complete sentence, sentence case, no trailing period unless
  multi-clause. Tells the user *what this field is for*, not what to type.
- **Errors:** specific and human ("That doesn't look like a valid address"),
  not error codes.
- **Optional fields:** pass `optional` — shows a small `opt` chip.
- The `>` prefix character is part of the label decoration and is automatic.

### 6.4 `<StatusBadge>` and `<StatusDot>`

```tsx
<StatusBadge tone="good" text="Wallet connected." />
<StatusDot tone="warn" pulse />
```

`StatusBadge` is a self-narrating pill. `StatusDot` is a 7px LED for inline
use (HUD chips, panel headers, wallet pill).

### 6.5 `<KV>` — key/value with dotted leader

```tsx
<KV k="balance" v="0.0123 ETH" tone="good" />
<KV k="chain"   v="aligned · 8453" />
```

Used inside the WALLET panel and anywhere you need a tight, dotted-leader
table. Keys lowercase uppercase-styled by CSS; values right-aligned mono.

### 6.6 `<Hex>` — address/hash with copy + explorer link

```tsx
<Hex
  value={txHash}
  href={`${network.explorer}/tx/${txHash}`}
  label="tx"          // used by the aria-label on the copy button
/>
```

Truncates to `0x123456…cdef`. Click the icon to copy; check icon flashes for
1.2 s on success. Every onchain identifier in the UI should use `<Hex>`.

### 6.7 `<LogStream>` — terminal event log

```tsx
<LogStream lines={logs} empty="Nothing here yet — actions you take will show up here." height={220} />
```

Lines are `{ id, ts, tone, text, tag }`. Tones colorize both the tag and text.
Auto-scrolls to bottom. The ACTIVITY panel uses this.

**Log tags:** short, lowercase, single word: `sys`, `rpc`, `wallet`, `net`,
`setup`, `post`, `identity`, `scan`. Don't invent verbose tags.

### 6.8 `<Skeleton>` — loading placeholder

```tsx
<Skeleton w="80%" h={18} />
```

Use during data fetches; never use it to fake content.

### 6.9 `<AsciiDivider>` — dashed labeled rule

```tsx
<AsciiDivider label="state" />
```

Use to break up dense panel content. Optional; don't sprinkle decoratively.

### 6.10 `<BootCursor>` — terminal cursor

A single `█` that blinks. Use once per page, after the typewriter intro.

### 6.11 Hooks

| Hook | What it does |
|---|---|
| `useTypewriter(text, speedMs)` | Returns a progressively-revealed string. Respects reduced-motion. |
| `useChainTelemetry(rpcUrl, chainId)` | Polls `getBlockNumber` + `getFeeData` every 12 s. Returns `{blockNumber, gasGwei, chainId, rttMs, online, loading}`. Gracefully returns nulls — never invents data. |
| `useBalance(rpcUrl, chainId, address, refreshKey)` | Native balance. Bump `refreshKey` to re-fetch. |

### 6.12 `<FiberBackdrop>`

The CSS+SVG dark-fiber backdrop. Mount once at the root of the app. No props.
Decorative, `aria-hidden`, hidden under reduced-motion.

---

## 7. Motion language

**Every animation is informational.** If you can't say what state change a
motion communicates, do not add it. All animations respect
`@media (prefers-reduced-motion: reduce)` — when motion is off, the *static*
visual state must still convey the same meaning (color, border, label).

### 7.1 Allowed animations

| Animation | Trigger | Duration | Purpose |
|---|---|---|---|
| `panel-pending` | `Panel pending={true}` | 1.6 s loop | Tx in-flight |
| `panel-flash` | `Panel flashKey` bump | 1.4 s one-shot | Confirmation success |
| `wallet-pill-busy` | `isPosting \|\| isSealingId` | 1.6 s loop | Wallet is signing/waiting |
| `dot-pulse` | `StatusDot pulse` | 2.2 s loop | Live status indicator |
| `cursor-blink` | `<BootCursor/>` | 1.05 s steps | Terminal cursor |
| `skel` | `<Skeleton/>` | 1.4 s loop | Data loading |
| `packet-flow` | `<FiberBackdrop/>` | 7–11 s loop | Ambient backdrop |
| Typewriter | `useTypewriter` | configurable | One-time intro |

### 7.2 Reduced-motion fallbacks

The reduced-motion media query in `styles.css` must keep:

- Pending panels: amber border (no pulse).
- Flashed panels: phosphor border (no fade).
- Busy wallet pill: amber border (no breathing).
- `<BootCursor>` visible but not blinking.
- `<FiberBackdrop>` hidden.

When adding a new animation, **add its reduced-motion fallback in the same PR.**

### 7.3 Easing / duration

- All transitions: `120–180 ms ease`.
- All pulses: `1.6 s ease-in-out`.
- Flashes: `1.4 s ease-out`.
- Never use `linear` for UI state changes (reserved for skeletons and packet flow).

---

## 8. Copy voice ⭐ critical

This is the section where models go wrong most often. **Read it twice.**

### 8.1 The two voices

| Surface | Voice | Example |
|---|---|---|
| **Panel labels, button text, field labels, NFO meta** | Terse, lowercase, technical | `TRANSMIT`, `post`, `contract address`, `[ network ░ base.sepolia ]` |
| **Status text, log messages, hints, empty states, lede, error messages** | Friendly, sentence-case, full sentences | `Wallet connected.`, `Set a contract address before posting.`, `No posts found in this range.` |

### 8.2 Hard rules

1. **Never use design-brief language in the UI.** Specifically banned phrases:
   - "base command layer", "command deck", "deck cold/online"
   - "signer" as a noun in user-facing copy (use "wallet")
   - "sealed", "seal", "sealing" (use "confirmed", "save", "saving")
   - "signal", "signals" referring to posts (use "post", "posts")
   - "no custody" repeated as a slogan
   - "keys airgapped" (overclaim — keys are in the wallet extension)
   - "void · no signal", "cold start", "tx.sealed", "scan.begin"
2. **Status text is for humans.** It must tell the user what happened or what
   to do next. `"signal sealed onchain"` is brand-flavored noise.
   `"Post confirmed."` is a status.
3. **Error messages name a fix.** "Set a contract address before posting."
   not "registry not pinned". "That author address doesn't look valid."
   not "BAD_ADDR".
4. **Buttons are verbs.** Lowercase, one or two words: `post`, `scan`,
   `connect wallet`, `switch network`, `save identity`. Past-tense or
   present-progressive when loading: `posting…`, `scanning…`, `saving…`.
5. **Panel labels are UPPERCASE single concepts.** `TRANSMIT`, `RECEIVE`,
   `WALLET`, `IDENTITY`, `ACTIVITY`, `TRUST MATRIX`. No punctuation. No
   "ID :: ALIAS" style stacking.
6. **NFO meta tags are real values, not flavor.**
   - Good: `[ network ░ base.sepolia ]`, `[ contract ░ 0x12…ab ]`,
     `[ wallet ░ connected ]`
   - Bad: `[ rel ░ green-channel ]`, `[ tgt ░ … ]`, `[ crc ░ … ]`,
     `[ sig ░ linked ]`

### 8.3 Voice cheat sheet

| ❌ Brief-leak | ✅ Product copy |
|---|---|
| deck cold · awaiting signer | Ready. Connect a wallet to start posting. |
| signer linked · keys airgapped | Wallet connected. |
| no eip-1193 provider | No browser wallet detected. Install MetaMask or a compatible wallet. |
| signal sealed onchain | Post confirmed. |
| void · no signal in range | No posts found in this range. |
| pin a registry address first | Set a contract address before posting. |
| author address malformed | That author address doesn't look valid. |
| payload is empty | Write something first. |
| tx.broadcast 0x… | Submitted tx 0x… |
| tx.sealed 0x… · block N | Confirmed in block N (0x…). |
| identity tx broadcast | Submitted. Waiting for confirmation… |
| chain.switch → base.sepolia | Switched network to base.sepolia. |
| flat-file spirit · public proof · base command layer | Sigline — small, signed, public, no custody. |

### 8.4 What technical jargon is OK

The aesthetic survives because some technical words are *precise*, not
flavor. These are fine:

- `RPC`, `gas`, `gwei`, `block`, `tx`, `chain id`, `contract address`
- `alias`, `twtxt url`
- `mainnet`, `sepolia`
- Panel labels like `TRANSMIT` (clear verb), `WALLET`, `ACTIVITY`

The test: **does removing this word make the sentence less informative?** If
yes, keep it. If no, it was flavor — cut it.

---

## 9. Accessibility

### 9.1 Required for every component

- **Visible focus.** All interactive elements get `outline: 2px solid var(--cyan); outline-offset: 2px;` on `:focus-visible`. Don't remove it.
- **Color is never the only signal.** Tone changes are always accompanied by
  text changes (status messages, button labels, ARIA labels).
- **`aria-busy`** on the wallet pill when a tx is in flight.
- **`role="status"`** on `<StatusBadge>`, **`role="log" aria-live="polite"`**
  on `<LogStream>`, **`role="separator"`** on `<AsciiDivider>`.
- **`aria-hidden`** on decorative ASCII (`<pre>` blocks, the fiber backdrop,
  the boot cursor, the typewriter motto line).
- **Decorative icons:** `aria-hidden="true"` on every `lucide-react` icon
  inside a button that already has a text label.

### 9.2 Keyboard

- Tab order follows DOM order: topbar → main grid → status bar.
- All buttons reachable; native `<details>` for the RPC disclosure (keyboard-toggleable).
- Inputs accept `Enter` to submit when paired with a default action (not yet wired — see roadmap).

### 9.3 Contrast

All defined text/background pairings meet WCAG AA at 13 px. When in doubt,
test against `--ink-2` (the typical panel background). `--text-faint` against
`--ink-2` is the lightest combo and clears 4.5:1.

---

## 10. Recipes — how to add things

### 10.1 New panel/module

```tsx
<Panel
  label="EXPORTS"
  meta="Download your post history"
  tone={isExporting ? "warn" : "idle"}
  pending={isExporting}
  flashKey={exportFlash}
>
  <Field label="format" hint="Pick an output format">
    <Select value={fmt} onChange={…}>
      <option value="json">JSON</option>
      <option value="twtxt">twtxt.txt</option>
    </Select>
  </Field>
  <div className="actions">
    <Button variant="primary" icon={<Download size={14}/>} onClick={runExport} loading={isExporting}>
      {isExporting ? "exporting…" : "export"}
    </Button>
  </div>
</Panel>
```

Then in the parent `grid` CSS, add a new area and place the panel.

### 10.2 New onchain action

1. **Don't put contract code in the component.** Add a helper to `chain.ts` or
   reuse `writableContract(contractAddress, network)`.
2. Mirror the existing post/identity pattern:
   - `setStatus({tone: "warn"|"idle"|"good"|"bad", text: <human sentence>})`
   - `appendLog(tone, "<human sentence>", "<tag>")`
   - `setXxxFlash(n => n+1)` after `await tx.wait()`
   - Toggle a local `isDoingX` boolean for the panel's `pending` prop and the
     wallet pill's busy state.
3. Map any new error code in `getDisplayErrorMessage()`.

### 10.3 New status

If you really need a new state, **don't** add a new color. Decide which of
`idle | good | warn | bad` it maps to, then add a clearer text or tag.

### 10.4 New chain or network

Add a `NetworkConfig` entry to `NETWORKS` in `chain.ts`. The `key` becomes a
new `NetworkKey` union member. The Select in TRANSMIT will need an option;
`readSavedSettings` already handles per-network contract addresses.

---

## 11. File map

```
frontend/
├── index.html                 — page shell, theme-color, noscript fallback
├── public/
│   └── favicon.svg            — Base-blue / cyan / phosphor mark
└── src/
    ├── main.tsx               — entry: <App/> render only
    ├── App.tsx                — composition + state (single component)
    ├── chain.ts               — networks, ABI, contract helpers, error mapper
    ├── components.tsx         — design-system primitives + hooks
    └── styles.css             — tokens, reset, primitives, layout, motion, a11y
```

**Rules of thumb for placement:**

- Anything that touches `BrowserProvider`, `JsonRpcProvider`, `Contract`, or
  EIP-1193 → `chain.ts`.
- Anything that has a stable visual shape and is reused → `components.tsx`.
- One-off layout + state for the Sigline screens → `App.tsx`.
- Tokens, primitives, layout → `styles.css`. No CSS-in-JS, no inline styles
  that duplicate a token.

---

## 12. Stack constraints

- **React 19**, **Vite 8**, **TypeScript**, **ethers v6**, **lucide-react**.
- **No Tailwind, no CSS-in-JS, no UI kit.** Plain CSS with custom properties.
- **No new runtime deps without justification.** The brief is explicit:
  prefer CSS + lightweight effects.
- **`three` is in `package.json` but unused.** Removing it is fine; don't
  re-introduce it for ambient effects.

---

## 13. Performance budget

- Production CSS: ≤ 30 kB / ≤ 8 kB gzip.
- Production JS: ≤ 200 kB gzip (most of which is `ethers`).
- No image larger than 64 kB. The favicon is the only image.
- Telemetry polling: 12 s minimum. Never poll faster.
- No layout thrash from animations: only `transform`, `opacity`,
  `border-color`, `box-shadow` are animated.

---

## 14. Checklist before shipping a change

- [ ] Used existing primitives where possible (`Panel`, `Field`, `Button`, `KV`, `Hex`, `LogStream`, `StatusBadge`, `Skeleton`)
- [ ] Tokens only — no raw hex/px duplicates
- [ ] Status uses `idle | good | warn | bad` only — no new colors
- [ ] Copy reviewed against §8 — no brief-leak phrases (`deck`, `signer`, `sealed`, `signal`, `no custody` slogan, etc.)
- [ ] Every error message names a fix the user can take
- [ ] Every new animation has a `prefers-reduced-motion` fallback that keeps meaning legible
- [ ] Interactive elements keep the cyan `:focus-visible` outline
- [ ] Tx-touching actions: pending pulse + flash on success + log line + status text + wallet-pill busy
- [ ] Onchain logic lives in `chain.ts`, not in components
- [ ] Live data is real (or the surface shows an explicit empty/loading/error state)
- [ ] `npx vite build` succeeds; bundle stays inside the §13 budget
- [ ] Responsive: tested at 1440 / 1024 / 768 / 375 widths

---

## 15. Glossary

| Term | Meaning |
|---|---|
| **Panel** | The framed module with a label header and corner ticks. The dominant UI container. |
| **HUD** | The compact chip row in the topbar (network, block, gas, wallet). |
| **NFO meta** | The square-bracket tags shown in the command-deck hero, e.g. `[ network ░ base.sepolia ]`. Each must hold a real value, not a slogan. |
| **Tone** | One of `idle | good | warn | bad`. Drives color across components. |
| **Pending** | Tx submitted, not yet confirmed. Amber. |
| **Flash** | One-shot phosphor confirmation animation on a panel. |
| **Telemetry** | Real RPC reads (block height, gas, RTT). Never synthesized. |
| **TRANSMIT / RECEIVE / WALLET / IDENTITY / ACTIVITY / TRUST MATRIX** | The six top-level panels. Do not rename them in passing. |

---

## 16. When in doubt

- **Default to clarity over flavor.** The aesthetic is strong because it sits
  on top of a clear product. If a flavor choice obscures what something does,
  drop the flavor.
- **Match the surrounding density.** If you're inside a Panel with KV rows and
  small mono text, your new element should also be mono and tight. Don't drop
  a marketing-sized headline into a dashboard.
- **One primary action per panel.** If you find yourself adding a second
  primary button, the panel is doing too much — split it, or demote one to
  `ghost` / `tonal`.
- **Read the result out loud.** If a status line sounds like a slogan, a
  threat, or a brief, rewrite it as something you'd say to a user over the
  shoulder.