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
  line pointer for each signer/index: content hash, timestamp, image hash, and
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
- Replies and echoes are stored as compact references to another line hash, so
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

Frontend
--------

The browser frontend lives in ``frontend/`` and uses wallet-based signing only.
It does not ask for or store private keys.

.. code-block:: console

    $ npm install
    $ npm run dev

Optional build-time defaults:

.. code-block:: console

    $ export VITE_BASE_NETWORK=base-sepolia
    $ export VITE_SIGLINE_CONTRACT=0xYourDeployedContract
    $ export VITE_BASE_RPC_URL=https://sepolia.base.org
    $ export VITE_BASE_FROM_BLOCK=12345678

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
  storage provider, then return JSON:

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

Optional upload defaults:

.. code-block:: console

    $ export VITE_IMAGE_UPLOAD_MODE=local-ipfs
    $ export VITE_IMAGE_UPLOAD_ENDPOINT=http://127.0.0.1:5001
    $ export VITE_IPFS_GATEWAY=https://ipfs.io/ipfs/{cid}
