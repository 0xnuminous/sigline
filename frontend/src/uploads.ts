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

export async function sha256Hex(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return `0x${[...new Uint8Array(digest)].map((byte) => HEX[byte]).join("")}`;
}

export function imageUriToGateway(uri: string, gateway = DEFAULT_IPFS_GATEWAY) {
  if (!uri) return "";
  if (uri.startsWith("ipfs://")) {
    const cid = uri.slice("ipfs://".length);
    return gateway.includes("{cid}")
      ? gateway.replace("{cid}", cid)
      : `${gateway.replace(/\/$/, "")}/${cid}`;
  }
  if (uri.startsWith("ar://")) return `https://arweave.net/${uri.slice(5)}`;
  if (uri.startsWith("https://")) return uri;
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
  if (result.hash && result.hash.toLowerCase() !== hash.toLowerCase()) {
    throw new Error("Upload endpoint returned an image hash mismatch.");
  }

  if (new TextEncoder().encode(result.uri).length > MAX_IMAGE_URI_BYTES) {
    throw new Error("Image URI is too long for the contract.");
  }

  return {
    ...result,
    hash,
    bytes: file.size,
    mime: file.type,
  };
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
