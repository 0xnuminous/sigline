import { MAX_IMAGE_BYTES, MAX_IMAGE_URI_BYTES } from "./chain";

export type ImageUploadMode = "local-ipfs" | "endpoint";

export type ImageUploadResult = {
  uri: string;
  gatewayUrl: string;
  hash: string;
  cid?: string;
  bytes: number;
  mime: string;
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

const HEX = [...Array(256)].map((_, i) => i.toString(16).padStart(2, "0"));

export function validateImageFile(file: File) {
  if (!IMAGE_MIME_TYPES.has(file.type)) {
    throw new Error("Use a PNG, JPG, GIF, or WebP image.");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("Keep images under 1 MB.");
  }
}

async function sha256BlobHex(blob: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return `0x${[...new Uint8Array(digest)].map((byte) => HEX[byte]).join("")}`;
}

export async function sha256Hex(file: File) {
  return sha256BlobHex(file);
}

export function imageUriToGateway(uri: string, gateway = DEFAULT_IPFS_GATEWAY) {
  const normalized = uri.trim();
  if (!normalized) return "";
  if (normalized.startsWith("ipfs://")) {
    const cid = normalized.slice("ipfs://".length);
    if (!cid) return "";
    return gateway.includes("{cid}")
      ? gateway.replace("{cid}", cid)
      : `${gateway.replace(/\/$/, "")}/${cid}`;
  }
  if (normalized.startsWith("ar://")) {
    const id = normalized.slice(5);
    return id ? `https://arweave.net/${id}` : "";
  }
  if (normalized.startsWith("https://")) {
    try {
      const url = new URL(normalized);
      return url.protocol === "https:" && url.host ? url.toString() : "";
    } catch {
      return "";
    }
  }
  return "";
}

export async function uploadImage(
  file: File,
  mode: ImageUploadMode,
  endpoint: string,
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
  const gatewayUrl = imageUriToGateway(imageUri);
  if (!gatewayUrl) {
    throw new Error("Image URI must use ipfs://, ar://, or https://.");
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

  const actualHash = await sha256BlobHex(await response.blob());
  if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
    throw new Error("IPFS returned image hash mismatch.");
  }
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
    gatewayUrl: imageUriToGateway(uri),
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
    gatewayUrl: result.gatewayUrl || imageUriToGateway(result.uri),
    hash: result.hash || "",
    cid: result.cid,
    bytes: result.bytes || file.size,
    mime: result.mime || file.type,
  };
}
