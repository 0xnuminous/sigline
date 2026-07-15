import { describe, expect, it } from "vitest";
import { summarizeFeedProvenance } from "./provenance";

describe("summarizeFeedProvenance", () => {
  it("summarizes scanned block provenance", () => {
    expect(
      summarizeFeedProvenance(
        {
          kind: "newer",
          scope: "tracked · 2",
          rpc: "mainnet.base.org",
          loaded: 3,
          totalLoaded: 12,
          scannedFromBlock: 100,
          scannedToBlock: 200,
          latestBlock: 250,
          at: 1_000_000,
        },
        1_125_000,
      ),
    ).toEqual({
      source: "newer scan",
      window: "#100-#200 · tip #250",
      rpc: "mainnet.base.org",
      scope: "tracked · 2",
      loaded: "3/12 loaded",
      age: "2m ago",
    });
  });

  it("summarizes local sample and saved provenance without block windows", () => {
    expect(
      summarizeFeedProvenance({
        kind: "sample",
        scope: "",
        rpc: "",
        loaded: 2,
        totalLoaded: 2,
        at: 0,
      }),
    ).toMatchObject({
      source: "sample",
      window: "not scanned",
      age: "not loaded",
    });
    expect(
      summarizeFeedProvenance({
        kind: "saved",
        scope: "browser",
        rpc: "local",
        loaded: 4,
        totalLoaded: 4,
        at: 1_000,
      }, 2_000),
    ).toMatchObject({
      source: "saved cache",
      window: "local only",
      loaded: "4/4 loaded",
      age: "1s ago",
    });
  });
});
