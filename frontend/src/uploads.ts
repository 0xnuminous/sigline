import { CID } from "multiformats/cid";
import { MAX_IMAGE_BYTES, MAX_IMAGE_URI_BYTES } from "./chain";

export type ImageUploadMode = "local-ipfs" | "endpoint";
export type ImageGatewayMode = "configured" | "fallbacks";

export type ImageUploadResult = {
  uri: string;
  gatewayUrl: string;
  hash: string;
  cid?: string;
  bytes: number;
  mime: string;
};

export type VerifiedImageBytes = {
  url: string;
  hash: string;
  bytes: number;
  mime: string;
  blob: Blob;
  attempted: string[];
};

export const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

export const DEFAULT_IMAGE_UPLOAD_MODE: ImageUploadMode =
  import.meta.env.VITE_IMAGE_UPLOAD_MODE === "endpoint"
    ? "endpoint"
    : "local-ipfs";

export const DEFAULT_IMAGE_UPLOAD_ENDPOINT =
  import.meta.env.VITE_IMAGE_UPLOAD_ENDPOINT ?? "http://127.0.0.1:5001";

export const DEFAULT_IPFS_GATEWAY =
  import.meta.env.VITE_IPFS_GATEWAY ?? "https://ipfs.io/ipfs/{cid}";

export const DEFAULT_ARWEAVE_GATEWAY =
  import.meta.env.VITE_ARWEAVE_GATEWAY ?? "https://arweave.net/{id}";

export const DEFAULT_IMAGE_GATEWAY_MODE: ImageGatewayMode =
  import.meta.env.VITE_IMAGE_GATEWAY_MODE === "configured"
    ? "configured"
    : "fallbacks";

const IPFS_FALLBACK_GATEWAYS = [
  DEFAULT_IPFS_GATEWAY,
  "https://dweb.link/ipfs/{cid}",
  "https://cloudflare-ipfs.com/ipfs/{cid}",
];
const ARWEAVE_FALLBACK_GATEWAYS = [
  DEFAULT_ARWEAVE_GATEWAY,
  "https://arweave.net/{id}",
  "https://ar-io.net/{id}",
];
const HEX = [...Array(256)].map((_, i) => i.toString(16).padStart(2, "0"));

export function validateImageFile(file: File) {
  if (!IMAGE_MIME_TYPES.has(file.type)) {
    throw new Error("Use a PNG, JPG, GIF, or WebP image.");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("Keep images under 1 MB.");
  }
}

async function sha256BytesHex(bytes: Uint8Array<ArrayBuffer>) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `0x${[...new Uint8Array(digest)].map((byte) => HEX[byte]).join("")}`;
}

async function sha256BlobHex(blob: Blob) {
  return sha256BytesHex(new Uint8Array(await blob.arrayBuffer()));
}

export async function sha256Hex(file: File) {
  return sha256BlobHex(file);
}

export async function verifyImageBytes(url: string, expectedHash: string) {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Image fetch failed (${response.status}).`);
    }
    const verified = await readImageResponse(response, { requireImageMime: true });
    const actualHash = verified.hash;
    if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
      throw new Error("Image hash mismatch.");
    }
    return verified;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Image fetch timed out.", { cause: error });
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export async function verifyImageUri(
  uri: string,
  expectedHash: string,
  options: { preferredGatewayUrl?: string; useFallbackGateways?: boolean } = {},
): Promise<VerifiedImageBytes> {
  const gateways = imageUriToGateways(uri, {
    preferredGatewayUrl: options.preferredGatewayUrl,
    useFallbackGateways: options.useFallbackGateways,
  });
  if (gateways.length === 0) {
    throw new Error("Image URI is not renderable by this client.");
  }
  const errors: string[] = [];
  for (const url of gateways) {
    try {
      const result = await verifyImageBytes(url, expectedHash);
      return { ...result, url, attempted: gateways };
    } catch (error) {
      errors.push(`${gatewayHost(url)}: ${getVerificationError(error)}`);
    }
  }
  throw new Error(`Image verification failed on ${gateways.length} gateway${gateways.length === 1 ? "" : "s"}: ${errors.join("; ")}`);
}

export function imageUriToGateway(uri: string, gateway = DEFAULT_IPFS_GATEWAY) {
  return imageUriToGateways(uri, { ipfsGateway: gateway })[0] ?? "";
}

export function imageUriToGateways(
  uri: string,
  options: {
    arweaveGateway?: string;
    ipfsGateway?: string;
    preferredGatewayUrl?: string;
    useFallbackGateways?: boolean;
  } = {},
) {
  const normalized = uri.trim();
  if (!normalized) return [];
  const useFallbackGateways = options.useFallbackGateways ?? true;
  const preferred = normalizePreferredGatewayUrl(
    normalized,
    options.preferredGatewayUrl ?? "",
  );
  const urls: string[] = [];
  if (preferred) urls.push(preferred);
  if (normalized.startsWith("ipfs://")) {
    const parsed = parseIpfsImageUri(normalized);
    if (!parsed) return [];
    const cidPath = `${parsed.cid}${parsed.path}`;
    const gateways = [
      options.ipfsGateway ?? DEFAULT_IPFS_GATEWAY,
      ...(useFallbackGateways ? IPFS_FALLBACK_GATEWAYS : []),
    ];
    gateways.forEach((gateway) => {
      urls.push(renderIpfsGateway(gateway, cidPath));
    });
    return uniqueUrls(urls);
  }
  if (normalized.startsWith("ar://")) {
    const parsed = parseArweaveImageUri(normalized);
    if (!parsed) return [];
    const idPath = `${parsed.id}${parsed.path}`;
    const gateways = [
      options.arweaveGateway ?? DEFAULT_ARWEAVE_GATEWAY,
      ...(useFallbackGateways ? ARWEAVE_FALLBACK_GATEWAYS : []),
    ];
    gateways.forEach((gateway) => {
      urls.push(gateway.replace("{id}", idPath));
    });
    return uniqueUrls(urls);
  }
  if (normalized.startsWith("https://")) {
    try {
      const url = new URL(normalized);
      if (url.protocol === "https:" && url.host) urls.push(url.toString());
      return uniqueUrls(urls);
    } catch {
      return [];
    }
  }
  return [];
}

export function isContentAddressedImageUri(uri: string) {
  const normalized = uri.trim();
  return Boolean(parseIpfsImageUri(normalized) || parseArweaveImageUri(normalized));
}

function parseIpfsImageUri(value: string) {
  if (!value.startsWith("ipfs://") || /\s|[?#]/.test(value)) return null;
  const suffix = value.slice("ipfs://".length);
  const [cid, ...pathParts] = suffix.split("/");
  if (!cid || pathParts.some(isUnsafePathPart)) return null;
  try {
    CID.parse(cid);
    return { cid, path: pathParts.length ? `/${pathParts.join("/")}` : "" };
  } catch {
    return null;
  }
}

function parseArweaveImageUri(value: string) {
  if (!value.startsWith("ar://") || /\s|[?#]/.test(value)) return null;
  const suffix = value.slice("ar://".length);
  const [id, ...pathParts] = suffix.split("/");
  if (!/^[A-Za-z0-9_-]{43}$/.test(id) || pathParts.some(isUnsafePathPart)) {
    return null;
  }
  return { id, path: pathParts.length ? `/${pathParts.join("/")}` : "" };
}

function isUnsafePathPart(part: string) {
  if (!part || part === "." || part === "..") return true;
  try {
    const decoded = decodeURIComponent(part);
    return decoded === "." || decoded === ".." || /[\\/]/.test(decoded);
  } catch {
    return true;
  }
}

function renderIpfsGateway(gateway: string, cidPath: string) {
  return gateway.includes("{cid}")
    ? gateway.replace("{cid}", cidPath)
    : `${gateway.replace(/\/$/, "")}/${cidPath}`;
}

function uniqueUrls(values: string[]) {
  const seen = new Set<string>();
  const urls: string[] = [];
  values.forEach((value) => {
    const normalized = normalizeEndpointGatewayUrl(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    urls.push(normalized);
  });
  return urls;
}

function gatewayHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return "gateway";
  }
}

function getVerificationError(error: unknown) {
  return error instanceof Error ? error.message : "verification failed";
}

export async function uploadImage(
  file: File,
  mode: ImageUploadMode,
  endpoint: string,
  options: { useFallbackGateways?: boolean } = {},
): Promise<ImageUploadResult> {
  validateImageFile(file);
  const hash = await sha256Hex(file);
  const result =
    mode === "endpoint"
      ? await uploadViaEndpoint(file, endpoint)
      : await uploadViaLocalIpfs(file, endpoint);
  const returnedHash = result.hash?.trim();
  if (returnedHash && returnedHash.toLowerCase() !== hash.toLowerCase()) {
    throw new Error("Upload endpoint returned an image hash mismatch.");
  }
  if (mode === "local-ipfs" && result.cid) {
    await verifyLocalIpfsContent(endpoint, result.cid, hash);
  }

  const imageUri = result.uri.trim();
  if (new TextEncoder().encode(imageUri).length > MAX_IMAGE_URI_BYTES) {
    throw new Error("Image URI is too long for the contract.");
  }
  if (!isContentAddressedImageUri(imageUri)) {
    throw new Error("Image URI must be content-addressed with ipfs:// or ar://.");
  }
  const fallbackGatewayUrl = imageUriToGateway(imageUri);
  if (!fallbackGatewayUrl) {
    throw new Error("Image URI is not renderable by this client.");
  }
  const providedGateway = result.gatewayUrl?.trim();
  const gatewayUrl = providedGateway
    ? normalizePreferredGatewayUrl(imageUri, providedGateway)
    : fallbackGatewayUrl;
  if (!gatewayUrl) {
    throw new Error("Image gateway URL must use https:// and render the stored image URI.");
  }
  if (mode === "endpoint") {
    await verifyImageUri(imageUri, hash, {
      preferredGatewayUrl: gatewayUrl,
      useFallbackGateways: options.useFallbackGateways,
    });
  }

  return {
    ...result,
    uri: imageUri,
    gatewayUrl,
    hash,
    bytes: file.size,
    mime: file.type,
  };
}

async function verifyLocalIpfsContent(
  endpoint: string,
  cid: string,
  expectedHash: string,
) {
  const response = await fetch(
    `${endpoint.replace(/\/$/, "")}/api/v0/cat?arg=${encodeURIComponent(cid)}`,
    { method: "POST" },
  );
  if (!response.ok) {
    throw new Error(`IPFS verification failed (${response.status}).`);
  }

  const verified = await readImageResponse(response, { requireImageMime: false });
  if (verified.hash.toLowerCase() !== expectedHash.toLowerCase()) {
    throw new Error("IPFS returned image hash mismatch.");
  }
}

async function readImageResponse(
  response: Response,
  options: { requireImageMime: boolean },
) {
  const contentLength = response.headers.get("Content-Length");
  if (contentLength) {
    const bytes = Number(contentLength);
    if (Number.isFinite(bytes) && bytes > MAX_IMAGE_BYTES) {
      throw new Error("Fetched image is over 1 MB.");
    }
  }

  if (!response.body) {
    const blob = await response.blob();
    if (blob.size > MAX_IMAGE_BYTES) {
      throw new Error("Fetched image is over 1 MB.");
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const mime = resolveImageMime(
      bytes,
      normalizeMime(blob.type || response.headers.get("Content-Type")),
      options.requireImageMime,
    );
    if (options.requireImageMime && !mime) {
      throw new Error("Fetched file is not an allowed image type.");
    }
    return {
      hash: await sha256BytesHex(bytes),
      bytes: blob.size,
      mime: mime || "unknown",
      blob: new Blob([bytes], { type: mime }),
    };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > MAX_IMAGE_BYTES) {
        await reader.cancel();
        throw new Error("Fetched image is over 1 MB.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });
  const mime = resolveImageMime(
    bytes,
    normalizeMime(response.headers.get("Content-Type")),
    options.requireImageMime,
  );
  if (options.requireImageMime && !mime) {
    throw new Error("Fetched file is not an allowed image type.");
  }
  return {
    hash: await sha256BytesHex(bytes),
    bytes: size,
    mime: mime || "unknown",
    blob: new Blob([bytes], { type: mime }),
  };
}

function normalizeMime(value: string | null | undefined) {
  return (value ?? "").split(";")[0].trim().toLowerCase();
}

function resolveImageMime(
  bytes: Uint8Array,
  reportedMime: string,
  requireImageMime: boolean,
) {
  if (IMAGE_MIME_TYPES.has(reportedMime)) return reportedMime;
  if (
    requireImageMime &&
    reportedMime &&
    reportedMime !== "application/octet-stream" &&
    reportedMime !== "binary/octet-stream"
  ) {
    return "";
  }
  return sniffImageMime(bytes) || (requireImageMime ? "" : reportedMime);
}

function sniffImageMime(bytes: Uint8Array) {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return "";
}

function normalizeEndpointGatewayUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.host ? url.toString() : "";
  } catch {
    return "";
  }
}

function normalizePreferredGatewayUrl(uri: string, value: string) {
  const normalized = normalizeEndpointGatewayUrl(value);
  if (!normalized) return "";
  return gatewayUrlMatchesImageUri(uri, normalized) ? normalized : "";
}

function gatewayUrlMatchesImageUri(uri: string, gatewayUrl: string) {
  try {
    const url = new URL(gatewayUrl);
    const ipfs = parseIpfsImageUri(uri);
    if (ipfs) {
      const cidPath = `${ipfs.cid}${ipfs.path}`;
      const pathGateway = normalizeGatewayPath(url.pathname) === `/ipfs/${cidPath}`;
      const subdomainGateway =
        url.hostname.toLowerCase().startsWith(`${ipfs.cid.toLowerCase()}.ipfs.`) &&
        normalizeGatewayPath(url.pathname) === (ipfs.path || "/");
      return pathGateway || subdomainGateway;
    }
    const arweave = parseArweaveImageUri(uri);
    if (arweave) {
      return normalizeGatewayPath(url.pathname) === `/${arweave.id}${arweave.path}`;
    }
    return uri.trim() === url.toString();
  } catch {
    return false;
  }
}

function normalizeGatewayPath(pathname: string) {
  return pathname.endsWith("/") && pathname !== "/"
    ? pathname.slice(0, -1)
    : pathname;
}

async function uploadViaLocalIpfs(
  file: File,
  endpoint: string,
): Promise<ImageUploadResult> {
  const form = new FormData();
  form.append("file", file, file.name || "sigline-image");
  const response = await fetch(
    `${endpoint.replace(/\/$/, "")}/api/v0/add?pin=true&cid-version=1&hash=sha2-256`,
    { method: "POST", body: form },
  );
  if (!response.ok) throw new Error(`IPFS upload failed (${response.status}).`);
  const body = await response.text();
  const rows = body
    .trim()
    .split(/\n+/)
    .map((line) => JSON.parse(line) as { Hash?: string });
  const cid = rows.at(-1)?.Hash;
  if (!cid) throw new Error("IPFS upload did not return a CID.");
  const uri = `ipfs://${cid}`;
  return {
    cid,
    uri,
    gatewayUrl: "",
    hash: "",
    bytes: file.size,
    mime: file.type,
  };
}

async function uploadViaEndpoint(
  file: File,
  endpoint: string,
): Promise<ImageUploadResult> {
  const form = new FormData();
  form.append("file", file, file.name || "sigline-image");
  const response = await fetch(endpoint, { method: "POST", body: form });
  if (!response.ok) {
    throw new Error(`Image upload endpoint failed (${response.status}).`);
  }
  const result = (await response.json()) as Partial<ImageUploadResult>;
  if (!result.uri) throw new Error("Upload endpoint did not return uri.");
  return {
    uri: result.uri,
    gatewayUrl: result.gatewayUrl?.trim() || "",
    hash: result.hash || "",
    cid: result.cid,
    bytes: result.bytes || file.size,
    mime: result.mime || file.type,
  };
}
