import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_IMAGE_BYTES, MAX_IMAGE_URI_BYTES } from "./chain";
import {
  imageUriToGateway,
  imageUriToGateways,
  isContentAddressedImageUri,
  uploadImage,
  verifyImageBytes,
  verifyImageUri,
} from "./uploads";

afterEach(() => {
  vi.unstubAllGlobals();
});

async function sha256Hex(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return `0x${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function pngFile(contents = "sigline-image-bytes") {
  return new File([contents], "sigline.png", { type: "image/png" });
}

function pngSignatureBytes() {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
  ]);
}

const VALID_IPFS_CID =
  "bafkreiffiageitnd2hhgakt4dtqmkbshqakdfctt274gu52t25ddcpzh5e";
const VALID_IPFS_CID_V0 = "QmZTid9Hu79Qux7upA73PqkU278XK3hhqrTfXh8w64k8yv";
const VALID_ARWEAVE_ID = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("imageUriToGateway", () => {
  it("normalizes supported decentralized image URIs", () => {
    expect(
      imageUriToGateway(`ipfs://${VALID_IPFS_CID}`, "https://ipfs.io/ipfs/{cid}"),
    ).toBe(
      `https://ipfs.io/ipfs/${VALID_IPFS_CID}`,
    );
    expect(imageUriToGateway(`ipfs://${VALID_IPFS_CID}`, "https://gw.example/ipfs")).toBe(
      `https://gw.example/ipfs/${VALID_IPFS_CID}`,
    );
    expect(imageUriToGateway(`ar://${VALID_ARWEAVE_ID}`)).toBe(
      `https://arweave.net/${VALID_ARWEAVE_ID}`,
    );
    expect(imageUriToGateway(`ipfs://${VALID_IPFS_CID}/photo.webp`)).toBe(
      `https://ipfs.io/ipfs/${VALID_IPFS_CID}/photo.webp`,
    );
    expect(imageUriToGateway("https://example.com/image.png")).toBe(
      "https://example.com/image.png",
    );
  });

  it("rejects non-renderable or unsafe schemes", () => {
    expect(imageUriToGateway("")).toBe("");
    expect(imageUriToGateway("ipfs://")).toBe("");
    expect(imageUriToGateway("ipfs://bafyimage")).toBe("");
    expect(imageUriToGateway(`ipfs://${VALID_IPFS_CID}//photo.webp`)).toBe("");
    expect(imageUriToGateway(`ipfs://${VALID_IPFS_CID}/%2e%2e/photo.webp`)).toBe("");
    expect(imageUriToGateway(`ipfs://${VALID_IPFS_CID}/safe%2fescape.webp`)).toBe("");
    expect(imageUriToGateway("http://example.com/image.png")).toBe("");
    expect(imageUriToGateway("javascript:alert(1)")).toBe("");
  });
});

describe("imageUriToGateways", () => {
  it("returns unique public fallback gateways for decentralized media", () => {
    expect(
      imageUriToGateways(`ipfs://${VALID_IPFS_CID}/photo.webp`, {
        preferredGatewayUrl: `https://gateway.example/ipfs/${VALID_IPFS_CID}/photo.webp`,
      }),
    ).toEqual([
      `https://gateway.example/ipfs/${VALID_IPFS_CID}/photo.webp`,
      `https://ipfs.io/ipfs/${VALID_IPFS_CID}/photo.webp`,
      `https://dweb.link/ipfs/${VALID_IPFS_CID}/photo.webp`,
      `https://cloudflare-ipfs.com/ipfs/${VALID_IPFS_CID}/photo.webp`,
    ]);
    expect(imageUriToGateways(`ar://${VALID_ARWEAVE_ID}`)).toEqual([
      `https://arweave.net/${VALID_ARWEAVE_ID}`,
      `https://ar-io.net/${VALID_ARWEAVE_ID}`,
    ]);
    expect(imageUriToGateways("https://example.com/image.png")).toEqual([
      "https://example.com/image.png",
    ]);
  });

  it("can restrict decentralized media reads to configured gateways", () => {
    expect(
      imageUriToGateways(`ipfs://${VALID_IPFS_CID}/photo.webp`, {
        ipfsGateway: "https://private.example/ipfs/{cid}",
        useFallbackGateways: false,
      }),
    ).toEqual([`https://private.example/ipfs/${VALID_IPFS_CID}/photo.webp`]);
    expect(
      imageUriToGateways(`ar://${VALID_ARWEAVE_ID}`, {
        arweaveGateway: "https://ar.example/{id}",
        useFallbackGateways: false,
      }),
    ).toEqual([`https://ar.example/${VALID_ARWEAVE_ID}`]);
  });
});

describe("isContentAddressedImageUri", () => {
  it("accepts only IPFS and Arweave storage URIs for app-posted media", () => {
    expect(isContentAddressedImageUri(`ipfs://${VALID_IPFS_CID}`)).toBe(true);
    expect(isContentAddressedImageUri(`ipfs://${VALID_IPFS_CID}/photo.webp`)).toBe(
      true,
    );
    expect(isContentAddressedImageUri(`ipfs://${VALID_IPFS_CID_V0}`)).toBe(true);
    expect(isContentAddressedImageUri(`ar://${VALID_ARWEAVE_ID}`)).toBe(true);
    expect(isContentAddressedImageUri("https://example.com/image.png")).toBe(false);
    expect(isContentAddressedImageUri("ipfs://")).toBe(false);
    expect(isContentAddressedImageUri("ipfs://bafyimage")).toBe(false);
    expect(isContentAddressedImageUri(`ipfs://${VALID_IPFS_CID}//image.png`)).toBe(
      false,
    );
    expect(isContentAddressedImageUri("ipfs://bafyimage?download=1")).toBe(false);
    expect(isContentAddressedImageUri("ipfs://bafy image")).toBe(false);
    expect(isContentAddressedImageUri(`ipfs://${VALID_IPFS_CID}/%2e`)).toBe(false);
    expect(isContentAddressedImageUri(`ipfs://${VALID_IPFS_CID}/safe%5cname`)).toBe(
      false,
    );
    expect(isContentAddressedImageUri("ar://short-id")).toBe(false);
  });
});

describe("verifyImageBytes", () => {
  it("returns a verified blob for allowed image bytes", async () => {
    const bytes = new TextEncoder().encode("sigline-image-bytes");
    const hash = await sha256Hex(bytes);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(bytes, {
          status: 200,
          headers: {
            "Content-Length": String(bytes.byteLength),
            "Content-Type": "image/png",
          },
        }),
      ),
    );

    const result = await verifyImageBytes("https://example.com/image.png", hash);

    expect(result.hash).toBe(hash);
    expect(result.bytes).toBe(bytes.byteLength);
    expect(result.mime).toBe("image/png");
    expect(result.blob.type).toBe("image/png");
  });

  it("rejects oversized images before reading the body when length is known", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("too large", {
          status: 200,
          headers: {
            "Content-Length": String(MAX_IMAGE_BYTES + 1),
            "Content-Type": "image/png",
          },
        }),
      ),
    );

    await expect(
      verifyImageBytes("https://example.com/image.png", `0x${"0".repeat(64)}`),
    ).rejects.toThrow("Fetched image is over 1 MB.");
  });

  it("rejects streamed images that grow past the byte cap", async () => {
    const chunk = new Uint8Array(MAX_IMAGE_BYTES + 1);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(chunk);
              controller.close();
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "image/png" },
          },
        ),
      ),
    );

    await expect(
      verifyImageBytes("https://example.com/image.png", `0x${"0".repeat(64)}`),
    ).rejects.toThrow("Fetched image is over 1 MB.");
  });

  it("rejects allowed image bytes when the hash does not match", async () => {
    const bytes = new TextEncoder().encode("sigline-image-bytes");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(bytes, {
          status: 200,
          headers: {
            "Content-Length": String(bytes.byteLength),
            "Content-Type": "image/png",
          },
        }),
      ),
    );

    await expect(
      verifyImageBytes("https://example.com/image.png", `0x${"0".repeat(64)}`),
    ).rejects.toThrow("Image hash mismatch.");
  });

  it("accepts matching image bytes from generic gateway MIME", async () => {
    const bytes = pngSignatureBytes();
    const hash = await sha256Hex(bytes);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(bytes, {
          status: 200,
          headers: {
            "Content-Length": String(bytes.byteLength),
            "Content-Type": "application/octet-stream",
          },
        }),
      ),
    );

    const result = await verifyImageBytes("https://example.com/image", hash);

    expect(result.hash).toBe(hash);
    expect(result.mime).toBe("image/png");
    expect(result.blob.type).toBe("image/png");
  });

  it("rejects matching bytes with a non-image MIME type", async () => {
    const bytes = new TextEncoder().encode("<svg></svg>");
    const hash = await sha256Hex(bytes);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(bytes, {
          status: 200,
          headers: {
            "Content-Length": String(bytes.byteLength),
            "Content-Type": "text/html; charset=utf-8",
          },
        }),
      ),
    );

    await expect(
      verifyImageBytes("https://example.com/image.svg", hash),
    ).rejects.toThrow("Fetched file is not an allowed image type.");
  });

  it("clears the timeout when fetch fails before returning a response", async () => {
    const timeoutId = 42;
    const clearTimeoutMock = vi.fn();
    vi.stubGlobal("setTimeout", vi.fn(() => timeoutId));
    vi.stubGlobal("clearTimeout", clearTimeoutMock);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }),
    );

    await expect(
      verifyImageBytes("https://example.com/image.png", `0x${"0".repeat(64)}`),
    ).rejects.toThrow("network down");
    expect(clearTimeoutMock).toHaveBeenCalledWith(timeoutId);
  });
});

describe("verifyImageUri", () => {
  it("falls through to a later gateway and reports the winning URL", async () => {
    const bytes = pngSignatureBytes();
    const hash = await sha256Hex(bytes);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 504 }))
      .mockResolvedValueOnce(
        new Response(bytes, {
          status: 200,
          headers: {
            "Content-Length": String(bytes.byteLength),
            "Content-Type": "application/octet-stream",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyImageUri(`ipfs://${VALID_IPFS_CID}`, hash, {
      preferredGatewayUrl: `https://gateway.example/ipfs/${VALID_IPFS_CID}`,
    });

    expect(result.url).toBe(`https://ipfs.io/ipfs/${VALID_IPFS_CID}`);
    expect(result.attempted).toHaveLength(4);
    expect(result.mime).toBe("image/png");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("summarizes failures after all gateways fail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("missing", { status: 404 })),
    );

    await expect(
      verifyImageUri(`ar://${VALID_ARWEAVE_ID}`, `0x${"0".repeat(64)}`),
    ).rejects.toThrow("Image verification failed on 2 gateways");
  });

  it("does not fetch public fallbacks when disabled", async () => {
    const fetchMock = vi.fn(async () => new Response("missing", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      verifyImageUri(`ipfs://${VALID_IPFS_CID}`, `0x${"0".repeat(64)}`, {
        useFallbackGateways: false,
      }),
    ).rejects.toThrow("Image verification failed on 1 gateway");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `https://ipfs.io/ipfs/${VALID_IPFS_CID}`,
      expect.any(Object),
    );
  });
});

describe("uploadImage", () => {
  it("accepts a BYO endpoint result and stores the local SHA-256 hash", async () => {
    const file = pngFile();
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const expectedHash = await sha256Hex(fileBytes);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          uri: `ipfs://${VALID_IPFS_CID}`,
          gatewayUrl: `https://gateway.example/ipfs/${VALID_IPFS_CID}`,
          hash: expectedHash,
          cid: VALID_IPFS_CID,
          bytes: file.size,
          mime: file.type,
        }),
      )
      .mockResolvedValueOnce(
        new Response(fileBytes, {
          status: 200,
          headers: {
            "Content-Length": String(fileBytes.byteLength),
            "Content-Type": "image/png",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await uploadImage(file, "endpoint", "https://upload.example");

    expect(result).toMatchObject({
      uri: `ipfs://${VALID_IPFS_CID}`,
      gatewayUrl: `https://gateway.example/ipfs/${VALID_IPFS_CID}`,
      hash: expectedHash,
      cid: VALID_IPFS_CID,
      bytes: file.size,
      mime: "image/png",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `https://gateway.example/ipfs/${VALID_IPFS_CID}`,
      expect.objectContaining({
        credentials: "omit",
        referrerPolicy: "no-referrer",
      }),
    );
  });

  it("rejects BYO endpoint results whose gateway bytes do not match the file", async () => {
    const file = pngFile("original-bytes");
    const expectedHash = await sha256Hex(new Uint8Array(await file.arrayBuffer()));
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({
            uri: `ipfs://${VALID_IPFS_CID}`,
            gatewayUrl: `https://gateway.example/ipfs/${VALID_IPFS_CID}`,
            hash: expectedHash,
          }),
        )
        .mockResolvedValue(
          new Response("different-bytes", {
            status: 200,
            headers: { "Content-Type": "image/png" },
          }),
        ),
    );

    await expect(
      uploadImage(file, "endpoint", "https://upload.example"),
    ).rejects.toThrow("Image verification failed on 4 gateways");
  });

  it("accepts a BYO endpoint result when the stored URI works on a fallback gateway", async () => {
    const file = pngFile();
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const expectedHash = await sha256Hex(fileBytes);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({
            uri: `ipfs://${VALID_IPFS_CID}`,
            gatewayUrl: `https://gateway.example/ipfs/${VALID_IPFS_CID}`,
            hash: expectedHash,
          }),
        )
        .mockResolvedValueOnce(new Response("unavailable", { status: 504 }))
        .mockResolvedValueOnce(
          new Response(fileBytes, {
            status: 200,
            headers: { "Content-Type": "image/png" },
          }),
        ),
    );

    await expect(
      uploadImage(file, "endpoint", "https://upload.example"),
    ).resolves.toMatchObject({
      uri: `ipfs://${VALID_IPFS_CID}`,
      gatewayUrl: `https://gateway.example/ipfs/${VALID_IPFS_CID}`,
      hash: expectedHash,
    });
  });

  it("does not use public fallback gateways for endpoint verification when disabled", async () => {
    const file = pngFile();
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const expectedHash = await sha256Hex(fileBytes);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          uri: `ipfs://${VALID_IPFS_CID}`,
          gatewayUrl: `https://gateway.example/ipfs/${VALID_IPFS_CID}`,
          hash: expectedHash,
        }),
      )
      .mockResolvedValue(new Response("unavailable", { status: 504 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      uploadImage(file, "endpoint", "https://upload.example", {
        useFallbackGateways: false,
      }),
    ).rejects.toThrow("Image verification failed on 2 gateways");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).not.toHaveBeenCalledWith(
      `https://dweb.link/ipfs/${VALID_IPFS_CID}`,
      expect.any(Object),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      `https://cloudflare-ipfs.com/ipfs/${VALID_IPFS_CID}`,
      expect.any(Object),
    );
  });

  it("rejects endpoint hash mismatches", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          uri: `ipfs://${VALID_IPFS_CID}`,
          hash: `0x${"1".repeat(64)}`,
        }),
      ),
    );

    await expect(
      uploadImage(pngFile(), "endpoint", "https://upload.example"),
    ).rejects.toThrow("Upload endpoint returned an image hash mismatch.");
  });

  it("rejects endpoint results with non-content-addressed image URI schemes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          uri: "https://example.com/not-decentralized.png",
        }),
      ),
    );

    await expect(
      uploadImage(pngFile(), "endpoint", "https://upload.example"),
    ).rejects.toThrow("Image URI must be content-addressed");
  });

  it("rejects endpoint results with malformed IPFS CIDs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          uri: "ipfs://bafyendpoint",
        }),
      ),
    );

    await expect(
      uploadImage(pngFile(), "endpoint", "https://upload.example"),
    ).rejects.toThrow("Image URI must be content-addressed");
  });

  it("rejects unsafe endpoint gateway URLs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          uri: `ipfs://${VALID_IPFS_CID}`,
          gatewayUrl: `http://gateway.example/ipfs/${VALID_IPFS_CID}`,
        }),
      ),
    );

    await expect(
      uploadImage(pngFile(), "endpoint", "https://upload.example"),
    ).rejects.toThrow("Image gateway URL must use https:// and render");
  });

  it("rejects endpoint gateway URLs that do not render the stored URI", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          uri: `ipfs://${VALID_IPFS_CID}`,
          gatewayUrl: "https://gateway.example/ipfs/different-cid",
        }),
      ),
    );

    await expect(
      uploadImage(pngFile(), "endpoint", "https://upload.example"),
    ).rejects.toThrow("Image gateway URL must use https:// and render");
  });

  it("rejects endpoint results with contract-oversized image URIs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          uri: `ipfs://${"a".repeat(MAX_IMAGE_URI_BYTES + 1)}`,
        }),
      ),
    );

    await expect(
      uploadImage(pngFile(), "endpoint", "https://upload.example"),
    ).rejects.toThrow("Image URI is too long for the contract.");
  });

  it("rejects local IPFS content that does not match the selected file", async () => {
    const file = pngFile("original-bytes");
    const addResponse = `${JSON.stringify({ Hash: "bafylocal" })}\n`;
    const catBytes = new TextEncoder().encode("different-bytes");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(addResponse, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(catBytes, {
          status: 200,
          headers: { "Content-Type": "image/png" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      uploadImage(file, "local-ipfs", "http://127.0.0.1:5001"),
    ).rejects.toThrow("IPFS returned image hash mismatch.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:5001/api/v0/cat?arg=bafylocal",
      { method: "POST" },
    );
  });
});
