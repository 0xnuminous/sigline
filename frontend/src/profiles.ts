import { EventLog, getAddress, isAddress } from "ethers";

export type ProfileEventKind = "updated" | "cleared";
export const MAX_PROFILE_PINS_PER_SCOPE = 200;
export const MAX_PROFILE_PIN_SCOPES = 10;
export const MAX_PROFILE_PIN_NICK_BYTES = 64;
export const MAX_PROFILE_PIN_URL_BYTES = 512;

export type ProfileEventItem = {
  id: string;
  account: string;
  kind: ProfileEventKind;
  nick: string;
  twtUrl: string;
  updatedAt: number;
  txHash: string;
  blockNumber: number;
  logIndex: number;
};

export type ProfileWatch = {
  latest?: ProfileEventItem;
  previous?: ProfileEventItem;
  eventCount: number;
  changed: boolean;
  tone: "idle" | "warn";
  label: string;
  detail: string;
};

export type ProfilePin = {
  address: string;
  nick: string;
  twtUrl: string;
  updatedAt: number;
  pinnedAt: number;
};

export type ProfilePinStatus = {
  changed: boolean;
  tone: "idle" | "warn";
  label: string;
  detail: string;
};

const SCOPE_RE = /^(base|base-sepolia):(\d+):0x[a-f0-9]{40}$/;
const EXPECTED_CHAIN_BY_NETWORK: Record<string, string> = {
  base: "8453",
  "base-sepolia": "84532",
};

export function toProfileEventItem(event: EventLog): ProfileEventItem | undefined {
  const name = event.fragment?.name;
  const args = event.args;
  const account = String(args.account ?? "");
  if (!isAddress(account)) return undefined;
  const normalizedAccount = getAddress(account);
  if (name === "ProfileUpdated") {
    return {
      id: `${event.transactionHash}-${event.index}`,
      account: normalizedAccount,
      kind: "updated",
      nick: String(args.nick ?? ""),
      twtUrl: String(args.twtUrl ?? ""),
      updatedAt: Number(args.updatedAt ?? 0),
      txHash: event.transactionHash,
      blockNumber: event.blockNumber,
      logIndex: event.index,
    };
  }
  if (name === "ProfileCleared") {
    return {
      id: `${event.transactionHash}-${event.index}`,
      account: normalizedAccount,
      kind: "cleared",
      nick: "",
      twtUrl: "",
      updatedAt: 0,
      txHash: event.transactionHash,
      blockNumber: event.blockNumber,
      logIndex: event.index,
    };
  }
  return undefined;
}

export function summarizeProfileWatches(events: ProfileEventItem[]) {
  const grouped = new Map<string, ProfileEventItem[]>();
  events.forEach((event) => {
    const key = event.account.toLowerCase();
    grouped.set(key, [...(grouped.get(key) ?? []), event]);
  });
  return Object.fromEntries(
    [...grouped.entries()].map(([account, items]) => [
      account,
      summarizeProfileWatch(items),
    ]),
  ) as Record<string, ProfileWatch>;
}

export function profilePinScopeKey(
  networkKey: string,
  chainId: bigint | number | string,
  contractAddress: string,
) {
  return isAddress(contractAddress) &&
    EXPECTED_CHAIN_BY_NETWORK[networkKey] === chainId.toString()
    ? `${networkKey}:${chainId.toString()}:${contractAddress.toLowerCase()}`
    : "";
}

export function makeProfilePin(
  profile: Pick<ProfilePin, "address" | "nick" | "twtUrl" | "updatedAt">,
  pinnedAt = Date.now(),
): ProfilePin | undefined {
  return normalizeProfilePin({ ...profile, pinnedAt });
}

export function normalizeProfilePin(value: unknown): ProfilePin | undefined {
  if (!isPlainRecord(value) || !isAddress(String(value.address ?? ""))) {
    return undefined;
  }
  const nick = normalizeProfilePinString(value.nick, MAX_PROFILE_PIN_NICK_BYTES);
  const twtUrl = normalizeProfilePinString(value.twtUrl, MAX_PROFILE_PIN_URL_BYTES);
  if (nick === undefined || twtUrl === undefined) return undefined;
  return {
    address: getAddress(String(value.address)),
    nick,
    twtUrl,
    updatedAt: normalizeProfilePinNumber(value.updatedAt),
    pinnedAt: normalizeProfilePinNumber(value.pinnedAt),
  };
}

export function normalizeProfilePins(value: unknown) {
  if (!isPlainRecord(value)) return {};
  const byAddress = new Map<string, ProfilePin>();
  Object.entries(value).forEach(([address, pin]) => {
    const withAddress = isPlainRecord(pin) ? { ...pin, address } : pin;
    const normalized = normalizeProfilePin(withAddress);
    if (!normalized) return;
    const key = normalized.address.toLowerCase();
    const current = byAddress.get(key);
    if (!current || normalized.pinnedAt >= current.pinnedAt) {
      byAddress.set(key, normalized);
    }
  });
  return Object.fromEntries(
    [...byAddress.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, MAX_PROFILE_PINS_PER_SCOPE),
  ) as Record<string, ProfilePin>;
}

export function normalizeProfilePinsByScope(value: unknown) {
  if (!isPlainRecord(value)) return {};
  const entries = Object.entries(value)
    .filter(([key]) => isValidProfilePinScope(key))
    .map(([key, pins]) => [key, normalizeProfilePins(pins)] as const)
    .filter(([, pins]) => Object.keys(pins).length > 0)
    .slice(0, MAX_PROFILE_PIN_SCOPES);
  return Object.fromEntries(entries) as Record<string, Record<string, ProfilePin>>;
}

export function getProfilePinStatus(
  pin: ProfilePin | undefined,
  current: Pick<ProfilePin, "address" | "nick" | "twtUrl" | "updatedAt"> & {
    available?: boolean;
  },
): ProfilePinStatus {
  if (!pin) {
    return {
      changed: false,
      tone: "idle",
      label: "profile not pinned",
      detail: "No local profile pin is stored for this address.",
    };
  }
  if (current.available === false) {
    return {
      changed: true,
      tone: "warn",
      label: "profile unavailable",
      detail: "The current sigcard could not be read, so the local profile pin was not compared.",
    };
  }
  const normalizedCurrent = makeProfilePin(current, pin.pinnedAt);
  if (!normalizedCurrent) {
    return {
      changed: true,
      tone: "warn",
      label: "profile unavailable",
      detail: "The pinned profile cannot be compared to the current sigcard.",
    };
  }
  const nickChanged = pin.nick !== normalizedCurrent.nick;
  const urlChanged = pin.twtUrl !== normalizedCurrent.twtUrl;
  if (!nickChanged && !urlChanged) {
    return {
      changed: false,
      tone: "idle",
      label: "profile matches pin",
      detail: "Current alias and URL match the local profile pin.",
    };
  }
  return {
    changed: true,
    tone: "warn",
    label:
      nickChanged && urlChanged
        ? "pinned alias and URL changed"
        : nickChanged
          ? "pinned alias changed"
          : urlChanged
            ? "pinned URL changed"
            : "profile matches pin",
    detail: `Pinned "${profilePinDisplay(pin)}"; current "${profilePinDisplay(normalizedCurrent)}". Address remains the identity.`,
  };
}

export function summarizeProfileWatch(events: ProfileEventItem[]): ProfileWatch {
  const sorted = [...events].sort(compareProfileEvents);
  const latest = sorted.at(-1);
  if (!latest) {
    return {
      eventCount: 0,
      changed: false,
      tone: "idle",
      label: "no profile events",
      detail: "No profile updates were found in the bounded watch window.",
    };
  }
  const previous = [...sorted]
    .slice(0, -1)
    .reverse()
    .find((event) => profileStateKey(event) !== profileStateKey(latest));
  const changed = Boolean(previous);
  const label = getProfileWatchLabel(latest, previous);
  return {
    latest,
    previous,
    eventCount: sorted.length,
    changed,
    tone: changed || latest.kind === "cleared" ? "warn" : "idle",
    label,
    detail: getProfileWatchDetail(label, latest, previous, sorted.length),
  };
}

function compareProfileEvents(a: ProfileEventItem, b: ProfileEventItem) {
  return a.blockNumber - b.blockNumber || a.logIndex - b.logIndex;
}

function profileStateKey(event: ProfileEventItem) {
  return [event.kind, event.nick, event.twtUrl].join("\u0000");
}

function getProfileWatchLabel(
  latest: ProfileEventItem,
  previous?: ProfileEventItem,
) {
  if (latest.kind === "cleared") return "profile cleared";
  if (!previous) return "profile first seen";
  const nickChanged = previous.nick !== latest.nick;
  const urlChanged = previous.twtUrl !== latest.twtUrl;
  if (nickChanged && urlChanged) return "alias and URL changed";
  if (nickChanged) return "alias changed";
  if (urlChanged) return "URL changed";
  return "profile rewritten";
}

function getProfileWatchDetail(
  label: string,
  latest: ProfileEventItem,
  previous: ProfileEventItem | undefined,
  eventCount: number,
) {
  if (!previous) {
    return `${label}; ${eventCount} profile event${eventCount === 1 ? "" : "s"} in the bounded watch window. Address remains the identity.`;
  }
  return `${label}; previous "${profileDisplay(previous)}", latest "${profileDisplay(latest)}". Address remains the identity.`;
}

function profileDisplay(event: ProfileEventItem) {
  if (event.kind === "cleared") return "cleared";
  return `${event.nick || "anon"}${event.twtUrl ? ` <${event.twtUrl}>` : ""}`;
}

function profilePinDisplay(pin: ProfilePin) {
  return `${pin.nick || "anon"}${pin.twtUrl ? ` <${pin.twtUrl}>` : ""}`;
}

function isValidProfilePinScope(value: string) {
  const match = SCOPE_RE.exec(value);
  if (!match) return false;
  return EXPECTED_CHAIN_BY_NETWORK[match[1]] === match[2];
}

function normalizeProfilePinString(value: unknown, maxBytes: number) {
  if (typeof value !== "string") return "";
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (
    hasUnsafeProfilePinChar(normalized) ||
    new TextEncoder().encode(normalized).length > maxBytes
  ) {
    return undefined;
  }
  return normalized;
}

function normalizeProfilePinNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

function hasUnsafeProfilePinChar(value: string) {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (
      code <= 0x1f ||
      (code >= 0x7f && code <= 0x9f) ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    ) {
      return true;
    }
  }
  return false;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
