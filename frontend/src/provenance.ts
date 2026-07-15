export type FeedProvenanceKind =
  | "sample"
  | "latest"
  | "newer"
  | "older"
  | "thread"
  | "link"
  | "saved";

export type FeedProvenance = {
  kind: FeedProvenanceKind;
  scope: string;
  rpc: string;
  loaded: number;
  totalLoaded: number;
  scannedFromBlock?: number;
  scannedToBlock?: number;
  latestBlock?: number;
  at: number;
};

export type FeedProvenanceSummary = {
  source: string;
  window: string;
  rpc: string;
  scope: string;
  loaded: string;
  age: string;
};

export function summarizeFeedProvenance(
  provenance: FeedProvenance,
  now = Date.now(),
): FeedProvenanceSummary {
  return {
    source: sourceLabel(provenance.kind),
    window: blockWindowLabel(provenance),
    rpc: provenance.rpc || "default rpc",
    scope: provenance.scope || "everyone",
    loaded: `${provenance.loaded}/${provenance.totalLoaded} loaded`,
    age: ageLabel(provenance.at, now),
  };
}

export function sourceLabel(kind: FeedProvenanceKind) {
  switch (kind) {
    case "latest":
      return "latest scan";
    case "newer":
      return "newer scan";
    case "older":
      return "older scan";
    case "thread":
      return "thread scan";
    case "link":
      return "public link";
    case "saved":
      return "saved cache";
    case "sample":
      return "sample";
  }
}

function blockWindowLabel(provenance: FeedProvenance) {
  if (
    provenance.scannedFromBlock === undefined ||
    provenance.scannedToBlock === undefined
  ) {
    return provenance.kind === "sample" ? "not scanned" : "local only";
  }
  const range = `#${formatBlock(provenance.scannedFromBlock)}-#${formatBlock(
    provenance.scannedToBlock,
  )}`;
  return provenance.latestBlock === undefined
    ? range
    : `${range} · tip #${formatBlock(provenance.latestBlock)}`;
}

function ageLabel(at: number, now: number) {
  if (!Number.isFinite(at) || at <= 0) return "not loaded";
  const elapsed = Math.max(0, Math.floor((now - at) / 1000));
  if (elapsed < 60) return `${elapsed}s ago`;
  const minutes = Math.floor(elapsed / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function formatBlock(value: number) {
  return Math.max(0, Math.floor(value)).toLocaleString("en-US");
}
