import { getAddress, isAddress } from "ethers";
import type { TimelineItem } from "./chain";

export const MAX_CIRCLES_PER_SCOPE = 12;
export const MAX_CIRCLE_MEMBERS = 100;
export const MAX_CIRCLE_SCOPES = 10;
export const MAX_CIRCLE_NAME_BYTES = 32;

export type CircleId = `circle:${string}`;

export type LocalCircle = {
  id: CircleId;
  name: string;
  addresses: string[];
};

export type CircleSummary = LocalCircle & {
  visibleCount: number;
  unread: number;
  latestAt: number;
};

const SCOPE_RE = /^(base|base-sepolia):0x[a-f0-9]{40}$/;

export function circleScopeKey(networkKey: string, contractAddress: string) {
  return isAddress(contractAddress)
    ? `${networkKey}:${contractAddress.toLowerCase()}`
    : "";
}

export function normalizeCircleName(value: unknown) {
  if (typeof value !== "string") return "";
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (
    !normalized ||
    !/^[A-Za-z0-9][A-Za-z0-9 _.-]*$/.test(normalized) ||
    new TextEncoder().encode(normalized).length > MAX_CIRCLE_NAME_BYTES
  ) {
    return "";
  }
  return normalized;
}

export function circleIdFromName(value: string): CircleId | "" {
  const name = normalizeCircleName(value);
  if (!name) return "";
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `circle:${slug}` : "";
}

export function normalizeCircleMembers(value: unknown) {
  const seen = new Map<string, string>();
  if (!Array.isArray(value)) return [];
  value.forEach((item) => {
    if (typeof item !== "string" || !isAddress(item)) return;
    const normalized = getAddress(item);
    seen.set(normalized.toLowerCase(), normalized);
  });
  return [...seen.values()].sort().slice(0, MAX_CIRCLE_MEMBERS);
}

export function normalizeCircles(value: unknown) {
  if (!Array.isArray(value)) return [];
  const byId = new Map<CircleId, LocalCircle>();
  value.forEach((item) => {
    if (!isPlainRecord(item)) return;
    const name = normalizeCircleName(item.name);
    const id = circleIdFromName(
      typeof item.id === "string" && item.id.startsWith("circle:")
        ? item.id.slice(7)
        : name,
    );
    if (!name || !id) return;
    const addresses = normalizeCircleMembers(item.addresses);
    const current = byId.get(id);
    byId.set(id, {
      id,
      name: current?.name ?? name,
      addresses: mergeCircleMembers(current?.addresses ?? [], addresses),
    });
  });
  return [...byId.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MAX_CIRCLES_PER_SCOPE);
}

export function normalizeCirclesByScope(value: unknown) {
  if (!isPlainRecord(value)) return {};
  const entries = Object.entries(value)
    .filter(([key]) => SCOPE_RE.test(key))
    .map(([key, circles]) => [key, normalizeCircles(circles)] as const)
    .filter(([, circles]) => circles.length > 0)
    .slice(0, MAX_CIRCLE_SCOPES);
  return Object.fromEntries(entries) as Record<string, LocalCircle[]>;
}

export function mergeCircleMembers(
  current: readonly string[],
  additions: readonly string[],
) {
  return normalizeCircleMembers([...additions, ...current]);
}

export function upsertCircle(
  circles: readonly LocalCircle[],
  name: string,
  addresses: readonly string[] = [],
) {
  const normalizedName = normalizeCircleName(name);
  const id = circleIdFromName(normalizedName);
  if (!normalizedName || !id) return normalizeCircles(circles);
  const normalizedAddresses = normalizeCircleMembers(addresses);
  const next = normalizeCircles(circles);
  const index = next.findIndex((circle) => circle.id === id);
  if (index >= 0) {
    next[index] = {
      ...next[index],
      addresses: mergeCircleMembers(next[index].addresses, normalizedAddresses),
    };
    return next;
  }
  return normalizeCircles([
    ...next,
    { id, name: normalizedName, addresses: normalizedAddresses },
  ]);
}

export function deleteCircle(
  circles: readonly LocalCircle[],
  circleId: CircleId | "",
) {
  return normalizeCircles(circles).filter((circle) => circle.id !== circleId);
}

export function toggleCircleMember(
  circles: readonly LocalCircle[],
  circleId: CircleId | "",
  address: string,
) {
  if (!circleId || !isAddress(address)) return normalizeCircles(circles);
  const normalized = getAddress(address);
  return normalizeCircles(circles).map((circle) => {
    if (circle.id !== circleId) return circle;
    const exists = circle.addresses.some(
      (item) => item.toLowerCase() === normalized.toLowerCase(),
    );
    return {
      ...circle,
      addresses: exists
        ? circle.addresses.filter(
            (item) => item.toLowerCase() !== normalized.toLowerCase(),
          )
        : mergeCircleMembers(circle.addresses, [normalized]),
    };
  });
}

export function removeAddressFromCircles(
  circles: readonly LocalCircle[],
  address: string,
) {
  if (!isAddress(address)) return normalizeCircles(circles);
  const normalized = getAddress(address).toLowerCase();
  return normalizeCircles(circles).map((circle) => ({
    ...circle,
    addresses: circle.addresses.filter(
      (item) => item.toLowerCase() !== normalized,
    ),
  }));
}

export function circleMemberSet(
  circles: readonly LocalCircle[],
  circleId: CircleId | "",
) {
  const circle = normalizeCircles(circles).find((item) => item.id === circleId);
  return new Set((circle?.addresses ?? []).map((address) => address.toLowerCase()));
}

export function filterRowsByCircle(
  rows: readonly TimelineItem[],
  circles: readonly LocalCircle[],
  circleId: CircleId | "",
) {
  if (!circleId) return rows;
  const members = circleMemberSet(circles, circleId);
  if (members.size === 0) return [];
  return rows.filter((item) => members.has(item.author.toLowerCase()));
}

export function summarizeCircles(
  rows: readonly TimelineItem[],
  circles: readonly LocalCircle[],
  readHashes: ReadonlySet<string> = new Set(),
) {
  return normalizeCircles(circles)
    .map<CircleSummary>((circle) => {
      const members = new Set(
        circle.addresses.map((address) => address.toLowerCase()),
      );
      const matching = rows.filter((item) =>
        members.has(item.author.toLowerCase()),
      );
      return {
        ...circle,
        visibleCount: matching.length,
        unread: matching.filter(
          (item) => !readHashes.has(item.contentHash.toLowerCase()),
        ).length,
        latestAt: matching.reduce(
          (latest, item) => Math.max(latest, item.createdAt),
          0,
        ),
      };
    })
    .sort(
      (a, b) =>
        b.visibleCount - a.visibleCount ||
        b.latestAt - a.latestAt ||
        a.name.localeCompare(b.name),
    );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
