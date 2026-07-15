import { describe, expect, it } from "vitest";
import { getAddress } from "ethers";
import { STORAGE_KEY } from "./chain";
import {
  LOCAL_VAULT_SCHEMA,
  exportEncryptedVault,
  formatSettingsImportSummary,
  importEncryptedVault,
  normalizeSettingsJson,
} from "./vault";

const SETTINGS = {
  networkKey: "base-sepolia",
  rpcUrl: "https://sepolia.base.org",
  proofRpcUrl: "https://proof.example",
  imageGatewayMode: "configured",
  draftQueue: [
    {
      id: "draft:one",
      createdAt: 1,
      updatedAt: 2,
      networkKey: "base-sepolia",
      text: "queued",
    },
  ],
  trackedSigners: ["0x8fc6e1d2f21bb22b1013d05ecf1f06fd73cdcb34"],
  walletLabels: {
    "0x8fc6e1d2f21bb22b1013d05ecf1f06fd73cdcb34": "Alice",
  },
  walletFlags: {
    "0x8fc6e1d2f21bb22b1013d05ecf1f06fd73cdcb34": "watch",
  },
  lineNotes: {
    [`0x${"a".repeat(64)}`]: "follow up",
  },
  lineMarks: {
    [`0x${"a".repeat(64)}`]: "important",
  },
  circlesByScope: {
    "base-sepolia:0x0000000000000000000000000000000000000002": [
      {
        id: "circle:close",
        name: "Close",
        addresses: ["0x8fc6e1d2f21bb22b1013d05ecf1f06fd73cdcb34"],
      },
    ],
  },
  readerLensesByScope: {
    "base-sepolia:0x0000000000000000000000000000000000000002": [
      {
        id: "lens:needs-check-builders",
        name: "Needs Check Builders",
        query: "base",
        mode: "needs-check",
        channel: "tag:base",
        circle: "circle:close",
        sort: "newest",
        showMuted: false,
        updatedAt: 1,
      },
    ],
  },
  readerSources: [
    {
      name: "Base Builders",
      networkKey: "base-sepolia",
      contractAddress: "0x0000000000000000000000000000000000000002",
      fromBlock: "123",
      scanScope: "address",
      author: "0x8fc6e1d2f21bb22b1013d05ecf1f06fd73cdcb34",
      channel: "#Base",
      mode: "media",
      sort: "oldest",
      updatedAt: 12,
      rawUrl: "https://private.example/reader",
      rpcUrl: "https://private.example/rpc",
      proofRpcUrl: "https://private.example/proof",
      wallet: "0x1111111111111111111111111111111111111111",
      draftText: "drop me",
    },
  ],
  profilePinsByScope: {
    "base-sepolia:84532:0x0000000000000000000000000000000000000002": {
      "0x8fc6e1d2f21bb22b1013d05ecf1f06fd73cdcb34": {
        address: "0x8fc6e1d2f21bb22b1013d05ecf1f06fd73cdcb34",
        nick: "Alice",
        twtUrl: "https://example.com/alice.txt",
        updatedAt: 1,
        pinnedAt: 2,
      },
    },
  },
  mutedTerms: ["spam"],
  highlightedTerms: ["base"],
  savedLines: [`0x${"a".repeat(64)}`],
  ignored: "drop me",
};

describe("local vault settings normalization", () => {
  it("keeps only Sigline local settings keys", () => {
    const normalized = normalizeSettingsJson(JSON.stringify(SETTINGS));

    expect(normalized).not.toContain("private.example");
    expect(JSON.parse(normalized)).toEqual({
      networkKey: "base-sepolia",
      rpcUrl: "https://sepolia.base.org",
      proofRpcUrl: "https://proof.example",
      imageGatewayMode: "configured",
      draftQueue: [
        {
          id: "draft:one",
          createdAt: 1,
          updatedAt: 2,
          networkKey: "base-sepolia",
          text: "queued",
        },
      ],
      trackedSigners: ["0x8fc6e1d2f21bb22b1013d05ecf1f06fd73cdcb34"],
      walletLabels: {
        "0x8fc6e1d2f21bb22b1013d05ecf1f06fd73cdcb34": "Alice",
      },
      walletFlags: {
        "0x8fc6e1d2f21bb22b1013d05ecf1f06fd73cdcb34": "watch",
      },
      lineNotes: {
        [`0x${"a".repeat(64)}`]: "follow up",
      },
      lineMarks: {
        [`0x${"a".repeat(64)}`]: "important",
      },
      circlesByScope: {
        "base-sepolia:0x0000000000000000000000000000000000000002": [
          {
            id: "circle:close",
            name: "Close",
            addresses: ["0x8fc6e1d2f21bb22b1013d05ecf1f06fd73cdcb34"],
          },
        ],
      },
      readerLensesByScope: {
        "base-sepolia:0x0000000000000000000000000000000000000002": [
          {
            id: "lens:needs-check-builders",
            name: "Needs Check Builders",
            query: "base",
            mode: "needs-check",
            channel: "tag:base",
            circle: "circle:close",
            sort: "newest",
            showMuted: false,
            updatedAt: 1,
          },
        ],
      },
      readerSources: [
        {
          name: "Base Builders",
          networkKey: "base-sepolia",
          contractAddress: "0x0000000000000000000000000000000000000002",
          fromBlock: "123",
          scanScope: "address",
          author: getAddress("0x8fc6e1d2f21bb22b1013d05ecf1f06fd73cdcb34"),
          channel: "tag:base",
          mode: "media",
          sort: "oldest",
        },
      ],
      profilePinsByScope: {
        "base-sepolia:84532:0x0000000000000000000000000000000000000002": {
          "0x8fc6e1d2f21bb22b1013d05ecf1f06fd73cdcb34": {
            address: "0x8fc6e1d2f21bb22b1013d05ecf1f06fd73cdcb34",
            nick: "Alice",
            twtUrl: "https://example.com/alice.txt",
            updatedAt: 1,
            pinnedAt: 2,
          },
        },
      },
      mutedTerms: ["spam"],
      highlightedTerms: ["base"],
      savedLines: [`0x${"a".repeat(64)}`],
    });
  });

  it("rejects malformed settings", () => {
    expect(() => normalizeSettingsJson("{")).toThrow("JSON is invalid");
    expect(() => normalizeSettingsJson("[]")).toThrow("must be a JSON object");
  });

  it("summarizes sensitive settings before import", () => {
    const current = JSON.stringify({
      networkKey: "base-sepolia",
      contractsByNetwork: { "base-sepolia": "0x0000000000000000000000000000000000000002" },
      rpcUrl: "https://sepolia.base.org",
      trackedSigners: [],
      mutedTerms: [],
      savedLines: [],
    });
    const incoming = JSON.stringify({
      networkKey: "base",
      contractsByNetwork: { base: "0x0000000000000000000000000000000000000003" },
      rpcUrl: "https://mainnet.base.org",
      imageUploadEndpoint: "https://upload.example/pin",
      imageGatewayMode: "fallbacks",
      walletLabels: {
        "0x8fc6e1d2f21bb22b1013d05ecf1f06fd73cdcb34": "Alice",
      },
      walletFlags: {
        "0x8fc6e1d2f21bb22b1013d05ecf1f06fd73cdcb34": "blocked",
      },
      lineNotes: {
        [`0x${"a".repeat(64)}`]: "follow up",
      },
      lineMarks: {
        [`0x${"a".repeat(64)}`]: "important",
      },
      draftQueue: [
        {
          id: "draft:two",
          createdAt: 1,
          updatedAt: 2,
          networkKey: "base",
          text: "queued",
        },
      ],
      trackedSigners: ["0x8fc6e1d2f21bb22b1013d05ecf1f06fd73cdcb34"],
      circlesByScope: {
        "base:0x0000000000000000000000000000000000000003": [
          {
            id: "circle:builders",
            name: "Builders",
            addresses: ["0x8fc6e1d2f21bb22b1013d05ecf1f06fd73cdcb34"],
          },
        ],
      },
      readerLensesByScope: {
        "base:0x0000000000000000000000000000000000000003": [
          {
            id: "lens:unread-builders",
            name: "Unread Builders",
            query: "builders",
            mode: "unread",
            channel: "",
            circle: "circle:builders",
            sort: "oldest",
            showMuted: true,
            updatedAt: 2,
          },
        ],
      },
      readerSources: [
        {
          name: "Mainnet Media",
          networkKey: "base",
          contractAddress: "0x0000000000000000000000000000000000000003",
          fromBlock: "456",
          scanScope: "all",
          author: "",
          channel: "",
          mode: "media",
          sort: "newest",
        },
      ],
      profilePinsByScope: {
        "base:8453:0x0000000000000000000000000000000000000003": {
          "0x8fc6e1d2f21bb22b1013d05ecf1f06fd73cdcb34": {
            address: "0x8fc6e1d2f21bb22b1013d05ecf1f06fd73cdcb34",
            nick: "Alice",
            twtUrl: "https://example.com/new.txt",
            updatedAt: 3,
            pinnedAt: 4,
          },
        },
      },
      mutedTerms: ["spam"],
      highlightedTerms: ["base"],
      savedLines: [`0x${"a".repeat(64)}`],
      draftText: "draft",
    });

    expect(formatSettingsImportSummary(current, incoming)).toContain(
      "Network: base-sepolia -> base",
    );
    expect(formatSettingsImportSummary(current, incoming)).toContain(
      "Upload endpoint: not set -> upload.example",
    );
    expect(formatSettingsImportSummary(current, incoming)).toContain(
      "Image checks: default -> configured + public fallbacks",
    );
    expect(formatSettingsImportSummary(current, incoming)).toContain(
      "Tracked wallets: 0 -> 1",
    );
    expect(formatSettingsImportSummary(current, incoming)).toContain(
      "Private labels: 0 -> 1",
    );
    expect(formatSettingsImportSummary(current, incoming)).toContain(
      "Private wallet flags: 0 -> 1",
    );
    expect(formatSettingsImportSummary(current, incoming)).toContain(
      "Private notes: 0 -> 1",
    );
    expect(formatSettingsImportSummary(current, incoming)).toContain(
      "Private marks: 0 -> 1",
    );
    expect(formatSettingsImportSummary(current, incoming)).toContain(
      "Highlighted text: 0 -> 1",
    );
    expect(formatSettingsImportSummary(current, incoming)).toContain(
      "Circles: 0 -> 1",
    );
    expect(formatSettingsImportSummary(current, incoming)).toContain(
      "Reader lenses: 0 -> 1",
    );
    expect(formatSettingsImportSummary(current, incoming)).toContain(
      "Reader sources: 0 -> 1",
    );
    expect(formatSettingsImportSummary(current, incoming)).toContain(
      "Profile pins: 0 -> 1",
    );
    expect(formatSettingsImportSummary(current, incoming)).toContain(
      "Draft queue: 0 -> 1",
    );
    expect(formatSettingsImportSummary(current, incoming)).toContain(
      "Draft: no -> yes",
    );
  });
});

describe("encrypted local vault", () => {
  it("round-trips settings through an encrypted vault", async () => {
    const plaintext = normalizeSettingsJson(JSON.stringify(SETTINGS));
    const vault = await exportEncryptedVault(
      plaintext,
      "correct horse battery staple",
      "2026-05-28T00:00:00.000Z",
    );
    const parsed = JSON.parse(vault);

    expect(parsed).toMatchObject({
      schema: LOCAL_VAULT_SCHEMA,
      storageKey: STORAGE_KEY,
      exportedAt: "2026-05-28T00:00:00.000Z",
      kdf: "PBKDF2-SHA256",
      cipher: "AES-GCM-256",
      iterations: 210000,
    });
    expect(vault).not.toContain("sepolia.base.org");
    await expect(
      importEncryptedVault(vault, "correct horse battery staple"),
    ).resolves.toBe(plaintext);
  });

  it("rejects wrong passphrases and short passphrases", async () => {
    const vault = await exportEncryptedVault(
      JSON.stringify({ networkKey: "base-sepolia" }),
      "correct horse battery staple",
    );

    await expect(importEncryptedVault(vault, "wrong passphrase")).rejects.toThrow(
      "passphrase or ciphertext is invalid",
    );
    await expect(
      exportEncryptedVault(JSON.stringify({}), "short"),
    ).rejects.toThrow("at least 16 characters");
  });

  it("rejects unsupported vault schemas", async () => {
    await expect(
      importEncryptedVault(
        JSON.stringify({
          schema: "sigline.localVault.v0",
          storageKey: STORAGE_KEY,
        }),
        "correct horse battery staple",
      ),
    ).rejects.toThrow("schema is not supported");
  });

  it("rejects invalid vault key material", async () => {
    const vault = JSON.parse(
      await exportEncryptedVault(
        JSON.stringify({ networkKey: "base-sepolia" }),
        "correct horse battery staple",
      ),
    );
    vault.salt = btoa("short");

    await expect(
      importEncryptedVault(JSON.stringify(vault), "correct horse battery staple"),
    ).rejects.toThrow("key material is invalid");
  });

  it("exports larger settings without spreading the ciphertext", async () => {
    const payload = JSON.stringify({ draftText: "x".repeat(180_000) });
    const vault = await exportEncryptedVault(
      payload,
      "correct horse battery staple",
    );

    await expect(
      importEncryptedVault(vault, "correct horse battery staple"),
    ).resolves.toBe(normalizeSettingsJson(payload));
  });
});
