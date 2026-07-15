.. _base_chain:

Base Chain
==========

Sigline can publish and read posts on Base through the ``Sigline`` contract in
``contracts/Sigline.sol``. The integration keeps the original flat-file and
HTTP workflow intact: Base accounts are just another source type, written as
``base://<address>``.

Security model
--------------

The contract is deliberately small:

- Full post payloads are append-only events. The contract also stores a small
  line pointer for each wallet/index: content hash, timestamp, image hash, and
  optional reply/echo reference hash.
  This lets clients verify a line by address and index without storing full text
  in contract storage.
- Line content hashes use EIP-712 typed-data domain separation scoped to the
  ``Sigline`` contract, chain id, and contract address. The contract also exposes
  ``eip712Domain()`` for clients that want to inspect the active hash domain.
- Accounts can only post for themselves and update their own profile.
- Posts are capped at 140 bytes on-chain, matching original Twitter-length
  posts for ASCII text. Nick and URL byte lengths are also bounded.
- Images are not stored on-chain. Posts may include an optional image URI and
  SHA-256 hash so clients can retrieve the image from IPFS, Arweave, or another
  content-addressed store and verify the bytes. Image posts require a one-time
  ``0.01 ETH`` image pass for the posting address.
- Answers and echoes are stored as compact references to another line hash, so
  conversation and repost metadata is explicit instead of relying only on text
  prefixes. Clients should still treat a reference as an untrusted pointer until
  they fetch and verify the referenced line.
- The contract rejects accidental native-token transfers. The only payable path
  is ``buyImagePass()``, and anyone can call ``sweepFees()`` to send accumulated
  pass fees to the immutable deploy-time treasury.
- The owner can pause and unpause writes, and ownership transfer is two-step.
- Ownership renounce is disabled so the contract cannot be left permanently
  paused without an owner.
- Post text is public, permanent, and not encrypted. Do not publish secrets.

Base network configuration
--------------------------

The default network is Base Sepolia. Configure the deployed contract before
reading or writing:

.. code-block:: ini

    [base]
    network = base-sepolia
    rpc_url = https://sepolia.base.org
    contract = 0xYourDeployedContract
    from_block = 12345678

Base public RPC endpoints are useful for development, but they are rate-limited.
Use a dedicated provider endpoint for production traffic.

Deploy the contract
-------------------

Install dependencies and run the contract tests:

.. code-block:: console

    $ npm install
    $ forge test

Deploy with Foundry. Use Base Sepolia first:

.. code-block:: console

    $ export SIGLINE_BASE_RPC_URL=https://sepolia.base.org
    $ export BASE_DEPLOYER_PRIVATE_KEY=0x...
    $ export OWNER_ADDRESS=0x...
    $ forge create \
        --rpc-url "$SIGLINE_BASE_RPC_URL" \
        --private-key "$BASE_DEPLOYER_PRIVATE_KEY" \
        contracts/Sigline.sol:Sigline \
        --constructor-args "$OWNER_ADDRESS"

The constructor stores ``OWNER_ADDRESS`` as both the initial owner and immutable
fee treasury. If you want to use ENS, resolve it before deployment and pass the
resolved address:

.. code-block:: console

    $ export OWNER_ADDRESS=$(cast resolve-name neonapple.eth --rpc-url https://ethereum-rpc.publicnode.com)

After deployment, set ``[base] contract`` and ``[base] from_block`` to the
deployment address and deployment block.

Publish a post
--------------

The CLI never stores a private key in the Sigline config. It reads the signing key
from ``SIGLINE_BASE_PRIVATE_KEY`` by default:

.. code-block:: console

    $ export SIGLINE_BASE_PRIVATE_KEY=0x...
    $ sigline base-tweet "hello from Base"

Use ``--network base`` only when you intend to spend real ETH on Base Mainnet.
The command asks for confirmation unless ``--yes`` is passed.

Publish or inspect a profile
----------------------------

.. code-block:: console

    $ sigline base-profile --nick alice --twturl https://example.org/alice.txt
    $ sigline base-profile 0x0000000000000000000000000000000000000001

Follow and read Base accounts
-----------------------------

.. code-block:: console

    $ sigline follow alice base://0x0000000000000000000000000000000000000001
    $ sigline base-timeline alice
    $ sigline timeline

``sigline timeline`` includes Base-chain sources when ``[base] contract`` is set.

The frontend feed keeps scans bounded. A blank or zero start block reads the
latest window; a non-zero start block is treated as the earliest block the
latest-window scan may read. After each read, the feed shows the exact block
window it queried and keeps scan bookmarks for bounded navigation. ``newer``
scans continue forward from the next block without clearing the loaded feed.
``older`` scans page backward from the last queried lower block so older posts
remain reachable without doing an unbounded catch-up sweep.
The reader shows a feed provenance strip with the loaded source, block window,
RPC host, scan scope, row count, and load age; saved-cache-only rows are marked
as local browser cache instead of scanned contract data.
After a successful scan, the reader controls collapse into a compact scan bar so
the feed stays central.
``check visible`` verifies loaded rows against the configured RPC. For stronger
client-side proof, add a different ``proof rpc`` endpoint and run ``2-rpc
proof``; it checks only currently loaded rows and confirms the stored pointer,
receipt, event, and EIP-712 content commitment through the second provider.
Use the ``needs check`` feed lens to isolate real loaded rows that have not
passed a current same-RPC or second-RPC proof yet.
Real-row actions that spread or build on a line, including save, share, answer,
echo, thread loading, and bundles, stay locked until the row has passed either
same-RPC verification or second-RPC proof.
Before an answer or echo is posted, the selected parent line is checked again
against the configured RPC, stored pointer, receipt event, and EIP-712 content
commitment. This catches stale local drafts or scope changes before the wallet
signs the referenced write.
Answer and echo rows show a loaded inline preview when the referenced line is
already present in the current scan window. Lines with loaded answers or echoes
also show a compact thread lens so conversation activity is visible without
leaving the feed. Use ``load thread`` on a line to query the indexed
``refHash`` topic for answers and echoes in the latest bounded scan window; the
feed reports the exact block range loaded.
Changing scope, address, RPC, contract, network, or start block clears loaded
rows so old results are not presented as current. Sample rows cannot be saved,
shared, tracked, muted, answered, echoed into real posts, or exported as feed
JSON.
``copy bundle`` exports only currently visible real rows. The bundle includes
public line links, chain/contract context, local saved/tracked/muted flags, and
any same-RPC, second-RPC, or image verification status already shown in the UI.
Each real row also has a ``bundle`` action that copies the same public proof
shape for that single line. Bundles intentionally exclude configured RPC URLs
and upload endpoints. If a wallet is connected, feed bundles and follow packs
are signed before copying. The signature is over a deterministic digest of the
unsigned JSON plus schema, network, chain id, contract, and export timestamp.
Signature verification proves bundle provenance only; it does not make imported
lines trusted.
``import bundle`` accepts that public JSON back into the reader as a local
follow pack. The import path validates schema, size, line hashes, authors, and
required network/contract context, then can add the bundle's authors to tracked
wallets. For feed bundles, the reader recomputes each line's EIP-712 content
hash against the bundle's contract and chain before accepting the bundle. HTTPS
image URIs are allowed only as legacy/external reader pointers and are called
out in the import warning. Signed bundles show the verified signer in the import
preview. It does not render or trust imported post payloads.
Tracked wallets can also be copied as a compact ``sigline.followPack.v1`` object
with the same network and contract context; the import path accepts both schemas.
Saved lines are cached locally with their public link and latest proof status, so
the saved feed can still show those rows after scan results are cleared or the
reader starts in saved mode. Cached proof labels are historical; gated actions
unlock only after the row is checked in the current session.
Wallet and text mutes are local reader filters. They hide matching loaded lines
in the browser only; they are not written to chain and do not change anyone
else's view of the public feed.
The safety panel can copy, download, or import an encrypted settings backup for
browser-only state such as tracked wallets, mutes, saved lines, drafts, RPC
endpoints, and upload settings. Backups are encrypted client-side with a
passphrase before they touch the clipboard or download folder. Importing a
backup shows the network, contract, RPC, upload endpoint, and local-count changes
before replacing local browser settings. Live local storage remains normal
browser storage; the backup is the encrypted portable artifact.

Line share links are public read-only permalinks. They include the network,
chain id, contract, author, author index, block, content hash, and transaction
hash, then use ``#line-...`` only as the scroll anchor. A fresh browser can load
the link without connecting a wallet: the frontend verifies the Sigline
contract, reads ``line(author,index)``, fetches the exact ``PostPosted`` event
from the linked block, and checks the EIP-712 content commitment before showing
the row.
``copy link`` creates a public feed link for the current reader. It includes
only public scan context such as network, chain id, contract, start block, sort,
public channel, and an explicitly selected address scan. It omits local circles,
tracked lists, saved/read state, marks, notes, labels, mutes, search text, RPC
URLs, upload endpoints, and wallet identity.
Channel pills can copy the same public link scoped to that channel, and real
rows can copy a public link scoped to that row's author. These links do not
export local trust, circle, label, mute, or note state.
``copy thread`` creates a public link to a verified parent line and asks the
reader to load bounded answer/echo activity for that parent. The parent is still
verified first through the normal line-link checks, and loaded children are not
trusted for gated actions until each child passes its own verification.
``save source`` creates a local shortcut for the current public scan context.
Sources store only the network, contract, start block, author scope, public
channel, public mode, and sort. They do not store custom RPC URLs, proof RPC
URLs, wallet identity, drafts, private circles, local trust, or upload settings,
and applying a source waits for the user to press ``scan``.

Frontend
--------

The browser frontend lives in ``frontend/`` and uses wallet-based signing only.
It does not ask for or store private keys.
Unposted message text is saved only in this browser's local storage as a draft.
Answer and echo drafts store the referenced line separately from the message
text, so selecting a reference never truncates or rewrites the user's draft.
The identity panel can publish or clear the connected wallet's current alias and
twtxt URL. Clearing deletes only that wallet's current profile fields from
contract storage; it does not delete posts or historical profile events.

.. code-block:: console

    $ npm install
    $ npm run dev

Optional build-time defaults:

.. code-block:: console

    $ export VITE_BASE_NETWORK=base-sepolia
    $ export VITE_SIGLINE_CONTRACT=0xYourDeployedContract
    $ export VITE_SIGLINE_TREASURY=0xExpectedTreasury
    $ export VITE_BASE_RPC_URL=https://sepolia.base.org
    $ export VITE_BASE_FROM_BLOCK=12345678

Before write actions, the browser verifies the configured address looks like the
expected Sigline contract: EIP-712 name/version/chain, post typehash, image-pass
fee, and treasury. ``VITE_SIGLINE_TREASURY`` must be set for posting, identity
updates, and image-pass purchases.

Image uploads
~~~~~~~~~~~~~

The frontend can attach one optional image to a post. Sigline does not host
image bytes. The app stores only the image URI and SHA-256 hash on-chain; the
actual image must live on storage the user controls or explicitly chooses.

Image posts require the posting wallet to buy one image pass with
``buyImagePass()``. The pass costs ``0.01 ETH`` on the selected Base network.
Those fees remain in the contract until anyone calls ``sweepFees()``, which can
only send the full balance to the immutable treasury address set at deployment.

The browser never embeds provider API secrets.

Two upload modes are supported:

- ``local-ipfs`` posts directly to a local Kubo/IPFS API, defaulting to
  ``http://127.0.0.1:5001``. The local node must allow browser CORS for the
  app origin.
- ``endpoint`` posts the image to a bring-your-own upload proxy. That proxy is
  not a Sigline service; run it yourself or point it at a provider you choose.
  It can pin to IPFS, upload to Arweave/Irys, or use another decentralized
  storage provider, then return JSON. The stored ``uri`` must be
  content-addressed: ``ipfs://...`` or ``ar://...``. ``gatewayUrl`` is optional;
  if present, it must be a valid ``https://`` preview URL. If omitted, the
  browser uses the configured IPFS or Arweave gateway for previews.
  Before signing a post, endpoint uploads are fetched back through the URI that
  will be stored on-chain and compared against the selected file's SHA-256 hash.

.. code-block:: json

    {
      "uri": "ipfs://bafy...",
      "gatewayUrl": "https://ipfs.io/ipfs/bafy...",
      "hash": "0x...",
      "bytes": 12345,
      "mime": "image/png"
    }

Images are limited to PNG, JPG, GIF, or WebP under 1 MB. SVG is intentionally
rejected because it can carry active content in some rendering contexts.

Readers can use the feed's image check action to fetch a renderable image URL
and compare the bytes against the post's on-chain SHA-256 hash. A failed check
means the fetched bytes do not match what the wallet committed to, or that the
selected gateway blocked browser reads.
For ``ipfs://`` and ``ar://`` media, the reader can run in configured-only mode
or configured-plus-fallbacks mode. Configured-only tries only the configured
gateway for the storage network, plus an explicit endpoint-returned gateway URL
during BYO endpoint upload verification. Configured-plus-fallbacks can also try
public gateways such as ``ipfs.io``, ``dweb.link``, ``cloudflare-ipfs.com``,
``arweave.net``, and ``ar-io.net``. The first gateway that returns matching
bytes wins; the image is still hidden unless the hash check succeeds. Gateway
reads omit credentials and referrers, but any configured or public gateway can
still learn which media CID or Arweave id was requested. If the configured
gateway is ``ipfs.io`` or ``arweave.net``, configured-only mode still reads from
that public service.
Gateways that return valid PNG/JPG/GIF/WebP bytes as ``application/octet-stream``
are accepted after byte sniffing; explicit non-image MIME types are still
rejected.
Line verification compares the event, EIP-712 content hash, and stored line
pointer through the configured RPC. Use a second RPC or explorer independently
when you need provider-independent evidence.
The reader's ``check visible`` action snapshots the current real rows, checks
line pointers with one contract preflight on the configured RPC, and asks before
fetching visible image bytes from IPFS, Arweave, or HTTPS gateways. HTTPS image
URIs remain renderable for verification of older or external events, but the app
will not create new posts with HTTPS image URIs.

The frontend does not auto-load feed images before verification. It shows a
placeholder first, then renders the image after the hash check succeeds.

Optional upload defaults:

.. code-block:: console

    $ export VITE_IMAGE_UPLOAD_MODE=local-ipfs
    $ export VITE_IMAGE_UPLOAD_ENDPOINT=http://127.0.0.1:5001
    $ export VITE_IMAGE_GATEWAY_MODE=fallbacks
    $ export VITE_IPFS_GATEWAY=https://ipfs.io/ipfs/{cid}
    $ export VITE_ARWEAVE_GATEWAY=https://arweave.net/{id}
