# Sigline feature matrix

This matrix records the 60 user-facing features integrated into the React app.
It is an inventory, not a claim that every workflow has an end-to-end browser
test. The repository's unit, build, and contract gates remain authoritative for
automated coverage.

## Read and navigate

1. Network, contract, and RPC configuration.
2. Wallet connection and network switching.
3. Chain telemetry and wallet balance.
4. Sigline contract identity and preflight checks.
5. Feed scans for everyone, tracked wallets, or one address.
6. Bounded older and newer feed pagination.
7. Feed provenance display.
8. Collapsible compact scan controls.
9. Loaded-feed search.
10. Feed mode lenses.
11. Newest and oldest sorting.
12. Visible-feed statistics.
13. Tracked-wallet management.
14. Sigcard wallet roster.
15. Profile-change watches.
16. Local profile pins and change warnings.

## Organize locally

17. Private wallet labels.
18. Private wallet flags.
19. Local circle creation, deletion, and filtering.
20. Circle membership editing.
21. Hashtag and cashtag channel discovery and filtering.
22. Contract-scoped pinned channels.
23. Address and alias mention lens.
24. Local wallet muting and show-muted control.
25. Local text muting.
26. Text highlighting and the hot lens.
27. Per-line read state and mark-visible-read.
28. Saved lines with an offline cache and proof snapshots.
29. Private line notes.
30. Private line marks.
31. Private reader lenses.
32. Public-context reader source shortcuts.

## Verify and share

33. Single-line same-RPC verification.
34. Batch verification of visible lines.
35. Second-provider RPC proof.
36. Trust-gated line actions and the needs-check lens.
37. Answer and echo parent re-verification before posting.
38. Image hash verification and verified rendering.
39. Configured-only and public-fallback image gateway modes.
40. Public line permalinks with verified autoload.
41. Public feed links for general, channel, and author scopes.
42. Answer composition and publishing.
43. Echo composition and reference-only publishing.
44. Inline loaded-parent previews.
45. Bounded answer and echo thread loading with an inline thread lens.
46. Public thread links with autoload.
47. Visible feed-bundle export.
48. Wallet-signed bundles and follow packs.
49. Single-line proof-bundle export.
50. Bundle and follow-pack import preview and validation.
51. Applying imports to tracking or a selected circle.
52. Tracked-wallet follow-pack export.
53. Circle follow-pack export.
54. Clipboard feed digest.

## Write and recover

55. Autosaved compose state and a scoped multi-draft queue.
56. Text and reference-only posting.
57. Image attachments through local IPFS or a user-selected endpoint.
58. Image-pass purchase and image-post gating.
59. On-chain identity save and clear.
60. Encrypted local settings backup, download, and restore.

## Acceptance boundary

- Python commands run through `uv`.
- `npm run check` covers Ruff, Pytest, ESLint, TypeScript, Vitest, the Vite
  production build, Forge formatting, and Forge tests.
- Browser acceptance covers the feed-first layout, public reader-source
  save/apply/reload behavior, console errors, and horizontal overflow on desktop
  and narrow mobile viewports.
- Wallet prompts and transaction races require a browser wallet or provider
  harness; their generation and scope guards are reviewed statically until that
  harness exists.
