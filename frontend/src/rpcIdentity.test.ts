import { describe, expect, it } from "vitest";
import {
  areRpcEndpointsEquivalent,
  canonicalizeRpcEndpoint,
  doRpcEndpointsShareOrigin,
  rpcEndpointOrigin,
} from "./rpcIdentity";

describe("RPC endpoint identity", () => {
  it.each([
    ["HTTPS://RPC.Example.COM:443", "https://rpc.example.com/"],
    ["http://RPC.Example.COM:80/rpc/", "http://rpc.example.com/rpc"],
    ["https://rpc.example.com/a/../rpc", "https://rpc.example.com/rpc/"],
    ["https://rpc.example.com/rpc#", "https://rpc.example.com/rpc"],
    ["https://rpc.example.com/rpc?", "https://rpc.example.com/rpc"],
    ["https://rpc.example.com/rpc#one", "https://rpc.example.com/rpc#two"],
    ["https://rpc.example.com/rpc?a=1&b=2", "https://rpc.example.com/rpc?b=2&a=1"],
    ["https://rpc.example.com./rpc", "https://rpc.example.com/rpc"],
  ])("recognizes trivial aliases: %s", (left, right) => {
    expect(areRpcEndpointsEquivalent(left, right)).toBe(true);
    expect(canonicalizeRpcEndpoint(left)).toBe(
      canonicalizeRpcEndpoint(right),
    );
  });

  it.each([
    ["https://rpc.example.com/rpc", "https://rpc.example.com/archive"],
    ["https://rpc.example.com/rpc", "https://rpc.example.com/rpc/v1"],
    ["https://rpc.example.com/rpc?a=1", "https://rpc.example.com/rpc?a=2"],
    ["https://rpc.example.com/rpc", "https://other.example.com/rpc"],
    ["https://rpc.example.com/rpc", "https://sub.rpc.example.com/rpc"],
    ["https://rpc.example.com/rpc", "https://rpc.example.com:8443/rpc"],
    ["http://rpc.example.com/rpc", "https://rpc.example.com/rpc"],
  ])("keeps distinct endpoints distinct: %s", (left, right) => {
    expect(areRpcEndpointsEquivalent(left, right)).toBe(false);
  });

  it.each([
    undefined,
    null,
    42,
    "",
    "not a URL",
    "/relative/rpc",
    "ftp://rpc.example.com/rpc",
    "ws://rpc.example.com/rpc",
  ])("fails safely for invalid or non-HTTP input: %s", (value) => {
    expect(canonicalizeRpcEndpoint(value)).toBeUndefined();
    expect(areRpcEndpointsEquivalent(value, value)).toBe(false);
  });

  it("rejects credential-bearing URLs without serializing secrets", () => {
    const endpoint = "https://alice:super-secret@rpc.example.com/rpc";

    expect(canonicalizeRpcEndpoint(endpoint)).toBeUndefined();
    expect(
      areRpcEndpointsEquivalent(endpoint, "https://rpc.example.com/rpc"),
    ).toBe(false);
  });

  it("identifies endpoints operated behind the same origin", () => {
    expect(rpcEndpointOrigin("HTTPS://RPC.Example.COM:443/a")).toBe(
      "https://rpc.example.com",
    );
    expect(
      doRpcEndpointsShareOrigin(
        "https://rpc.example.com/public",
        "https://rpc.example.com/archive?key=two",
      ),
    ).toBe(true);
    expect(
      doRpcEndpointsShareOrigin(
        "https://rpc.example.com/public",
        "https://other.example.com/public",
      ),
    ).toBe(false);
  });
});
