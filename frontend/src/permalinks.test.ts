import { describe, expect, it } from "vitest";
import { getAddress } from "ethers";
import { REF_KIND_NONE, TimelineItem, ZERO_HASH } from "./chain";
import {
  buildLinePermalink,
  buildPublicReaderLink,
  buildThreadPermalink,
  parseLinePermalink,
  parsePublicReaderLink,
} from "./permalinks";

const AUTHOR = "0x8fc6e1d2f21bb22b1013d05ecf1f06fd73cdcb34";
const CONTRACT = "0xab7c8803962c0f2f5bbbe3fa8bf41cd82aa1923c";
const CONTENT_HASH = `0x${"a".repeat(64)}`;
const TX_HASH = `0x${"b".repeat(64)}`;

function line(): TimelineItem {
  return {
    id: CONTENT_HASH,
    author: AUTHOR,
    index: 4n,
    createdAt: 1_777_777_777,
    contentHash: CONTENT_HASH,
    text: "public line",
    imageUri: "",
    imageHash: ZERO_HASH,
    refHash: ZERO_HASH,
    refKind: REF_KIND_NONE,
    txHash: TX_HASH,
    blockNumber: 42,
  };
}

describe("buildLinePermalink", () => {
  it("adds enough public read-only state to hydrate a line", () => {
    const href = buildLinePermalink(
      "https://sigline.example/feed?old=1&rpc=https://private.example/key&proofRpcUrl=https://proof.example&apiKey=secret#deck",
      "base-sepolia",
      CONTRACT,
      line(),
    );
    const url = new URL(href);

    expect(url.searchParams.get("old")).toBeNull();
    expect(url.searchParams.get("rpc")).toBeNull();
    expect(url.searchParams.get("proofRpcUrl")).toBeNull();
    expect(url.searchParams.get("apiKey")).toBeNull();
    expect(url.searchParams.get("sigline")).toBe("line");
    expect(url.searchParams.get("v")).toBe("1");
    expect(url.searchParams.get("chainId")).toBe("84532");
    expect(url.searchParams.get("network")).toBe("base-sepolia");
    expect(url.searchParams.get("contract")).toBe(getAddress(CONTRACT));
    expect(url.searchParams.get("block")).toBe("42");
    expect(url.searchParams.get("author")).toBe(getAddress(AUTHOR));
    expect(url.searchParams.get("index")).toBe("4");
    expect(url.searchParams.get("contentHash")).toBe(CONTENT_HASH);
    expect(url.searchParams.get("txHash")).toBe(TX_HASH);
    expect(url.hash).toBe(`#line-${CONTENT_HASH.slice(2)}`);
  });

  it("can build a public thread link from the same verified line identity", () => {
    const href = buildThreadPermalink(
      "https://sigline.example/feed?rpc=https://private.example/key#deck",
      "base-sepolia",
      CONTRACT,
      line(),
    );
    const url = new URL(href);

    expect(url.searchParams.get("rpc")).toBeNull();
    expect(url.searchParams.get("sigline")).toBe("thread");
    expect(url.searchParams.get("thread")).toBe("1");
    expect(url.searchParams.get("contract")).toBe(getAddress(CONTRACT));
    expect(url.searchParams.get("author")).toBe(getAddress(AUTHOR));
    expect(url.searchParams.get("contentHash")).toBe(CONTENT_HASH);
    expect(url.hash).toBe(`#line-${CONTENT_HASH.slice(2)}`);
  });

  it("does not turn protocol-relative paths into external links", () => {
    const href = buildLinePermalink(
      "https://sigline.example//evil.example/path?rpc=https://private.example#deck",
      "base",
      CONTRACT,
      line(),
    );
    const url = new URL(href);

    expect(url.origin).toBe("https://sigline.example");
    expect(url.pathname).toBe("/");
    expect(url.searchParams.get("rpc")).toBeNull();
  });
});

describe("parseLinePermalink", () => {
  it("normalizes supported params and ignores invalid params", () => {
    const parsed = parseLinePermalink(
      `https://sigline.example/?sigline=line&v=1&chainId=8453&contract=${CONTRACT}&block=42&author=${AUTHOR}&index=4&contentHash=${CONTENT_HASH.toUpperCase()}&txHash=${TX_HASH}`,
    );

    expect(parsed).toEqual({
      networkKey: "base",
      chainId: "8453",
      contractAddress: getAddress(CONTRACT),
      fromBlock: "42",
      lineHash: CONTENT_HASH,
      author: getAddress(AUTHOR),
      index: "4",
      txHash: TX_HASH,
      wantsThread: false,
      shouldAutoLoad: true,
    });
  });

  it("supports legacy short aliases without auto-loading incomplete links", () => {
    const parsed = parseLinePermalink(
      `https://sigline.example/?net=base-sepolia&from=42&line=${CONTENT_HASH}`,
    );

    expect(parsed.networkKey).toBe("base-sepolia");
    expect(parsed.fromBlock).toBe("42");
    expect(parsed.lineHash).toBe(CONTENT_HASH);
    expect(parsed.wantsThread).toBe(false);
    expect(parsed.shouldAutoLoad).toBe(false);
  });

  it("can recover a line hash from the URL fragment", () => {
    expect(
      parseLinePermalink(`https://sigline.example/#line-${CONTENT_HASH.slice(2)}`)
        .lineHash,
    ).toBe(CONTENT_HASH);
    expect(
      parseLinePermalink(`https://sigline.example/#line-${CONTENT_HASH.slice(2)}`)
        .shouldAutoLoad,
    ).toBe(false);
  });

  it("recognizes thread links without weakening the line identity requirement", () => {
    const parsed = parseLinePermalink(
      `https://sigline.example/?sigline=thread&thread=1&chainId=8453&contract=${CONTRACT}&block=42&author=${AUTHOR}&index=4&contentHash=${CONTENT_HASH}&txHash=${TX_HASH}`,
    );

    expect(parsed.wantsThread).toBe(true);
    expect(parsed.shouldAutoLoad).toBe(true);
    expect(parsed.lineHash).toBe(CONTENT_HASH);
  });

  it("ignores oversized line links", () => {
    expect(
      parseLinePermalink(`https://sigline.example/?${"x".repeat(5000)}`),
    ).toEqual({ wantsThread: false, shouldAutoLoad: false });
  });
});

describe("buildPublicReaderLink", () => {
  it("copies only public reader state and strips private endpoints", () => {
    const href = buildPublicReaderLink(
      "https://sigline.example/feed?rpc=https://private.example/key&uploadEndpoint=https://uploads.example&circle=circle:friends#trust",
      {
        networkKey: "base-sepolia",
        contractAddress: CONTRACT,
        fromBlock: "123",
        scanScope: "address",
        targetAddress: AUTHOR,
        feedMode: "media",
        feedSort: "oldest",
        selectedChannel: "tag:base",
      },
    );
    const url = new URL(href);

    expect(url.searchParams.get("rpc")).toBeNull();
    expect(url.searchParams.get("uploadEndpoint")).toBeNull();
    expect(url.searchParams.get("circle")).toBeNull();
    expect(url.searchParams.get("sigline")).toBe("feed");
    expect(url.searchParams.get("chainId")).toBe("84532");
    expect(url.searchParams.get("network")).toBe("base-sepolia");
    expect(url.searchParams.get("contract")).toBe(getAddress(CONTRACT));
    expect(url.searchParams.get("from")).toBe("123");
    expect(url.searchParams.get("scope")).toBe("address");
    expect(url.searchParams.get("author")).toBe(getAddress(AUTHOR));
    expect(url.searchParams.get("mode")).toBe("media");
    expect(url.searchParams.get("sort")).toBe("oldest");
    expect(url.searchParams.get("channel")).toBe("tag:base");
    expect(url.hash).toBe("#deck");
  });

  it("omits local-only scope and feed modes", () => {
    const href = buildPublicReaderLink("https://sigline.example/#deck", {
      networkKey: "base",
      contractAddress: CONTRACT,
      fromBlock: "0",
      scanScope: "tracked",
      targetAddress: AUTHOR,
      feedMode: "saved",
      feedSort: "newest",
      selectedChannel: "",
    });
    const url = new URL(href);

    expect(url.searchParams.get("scope")).toBeNull();
    expect(url.searchParams.get("author")).toBeNull();
    expect(url.searchParams.get("mode")).toBeNull();
    expect(url.searchParams.get("sort")).toBeNull();
  });

  it("builds author discovery links without private reader filters", () => {
    const href = buildPublicReaderLink("https://sigline.example/#deck", {
      networkKey: "base",
      contractAddress: CONTRACT,
      fromBlock: "99",
      scanScope: "address",
      targetAddress: AUTHOR,
      feedMode: "flagged",
      feedSort: "newest",
      selectedChannel: "",
    });
    const url = new URL(href);

    expect(url.searchParams.get("author")).toBe(getAddress(AUTHOR));
    expect(url.searchParams.get("scope")).toBe("address");
    expect(url.searchParams.get("from")).toBe("99");
    expect(url.searchParams.get("mode")).toBeNull();
    expect(url.searchParams.get("q")).toBeNull();
  });

  it("does not turn protocol-relative paths into external feed links", () => {
    const href = buildPublicReaderLink(
      "https://sigline.example//evil.example/path?rpc=https://private.example#deck",
      {
        networkKey: "base",
        contractAddress: CONTRACT,
        fromBlock: "0",
        scanScope: "all",
        targetAddress: "",
        feedMode: "all",
        feedSort: "newest",
        selectedChannel: "",
      },
    );
    const url = new URL(href);

    expect(url.origin).toBe("https://sigline.example");
    expect(url.pathname).toBe("/");
    expect(url.searchParams.get("rpc")).toBeNull();
  });
});

describe("parsePublicReaderLink", () => {
  it("hydrates public reader filters", () => {
    const parsed = parsePublicReaderLink(
      `https://sigline.example/?sigline=feed&v=1&chainId=8453&contract=${CONTRACT}&from=123&author=${AUTHOR}&q=from%20builders&mode=refs&sort=oldest&channel=tag:base`,
    );

    expect(parsed).toEqual({
      isReaderLink: true,
      shouldAutoLoad: true,
      networkKey: "base",
      chainId: "8453",
      contractAddress: getAddress(CONTRACT),
      fromBlock: "123",
      scanScope: "address",
      author: getAddress(AUTHOR),
      feedMode: "refs",
      feedSort: "oldest",
      selectedChannel: "tag:base",
    });
  });

  it("ignores local-only params and unsupported modes", () => {
    const parsed = parsePublicReaderLink(
      `https://sigline.example/?sigline=feed&network=base&contract=${CONTRACT}&scope=tracked&circle=circle:friends&mode=saved&showMuted=1&rpc=https://private.example`,
    );

    expect(parsed.isReaderLink).toBe(true);
    expect(parsed.scanScope).toBe("all");
    expect(parsed.author).toBeUndefined();
    expect(parsed.feedMode).toBeUndefined();
    expect(parsed.selectedChannel).toBe("");
    expect(parsed.shouldAutoLoad).toBe(true);
  });

  it("leaves normal pages alone", () => {
    expect(parsePublicReaderLink("https://sigline.example/#deck")).toEqual({
      isReaderLink: false,
      shouldAutoLoad: false,
    });
  });

  it("does not treat thread links as public reader feed links", () => {
    expect(
      parsePublicReaderLink(
        `https://sigline.example/?sigline=thread&thread=1&chainId=8453&contract=${CONTRACT}&block=42&author=${AUTHOR}&index=4&contentHash=${CONTENT_HASH}`,
      ),
    ).toEqual({
      isReaderLink: false,
      shouldAutoLoad: false,
    });
  });

  it("ignores oversized public reader links", () => {
    expect(
      parsePublicReaderLink(
        `https://sigline.example/?sigline=feed&${"x".repeat(5000)}`,
      ),
    ).toEqual({
      isReaderLink: false,
      shouldAutoLoad: false,
    });
  });
});
