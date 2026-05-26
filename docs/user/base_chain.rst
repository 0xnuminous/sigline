.. _base_chain:

Base Chain
==========

twtxt can publish and read posts on Base through the ``BaseTwtxt`` contract in
``contracts/BaseTwtxt.sol``. The integration keeps the original flat-file and
HTTP workflow intact: Base accounts are just another source type, written as
``base://<address>``.

Security model
--------------

The contract is deliberately small:

- Posts are append-only events. The contract stores only per-account post counts
  and small profile records.
- Accounts can only post for themselves and update their own profile.
- Tweet, nick, and URL byte lengths are bounded on-chain.
- The contract rejects native-token transfers and does not implement token
  rescue or withdrawal flows.
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

    $ export TWTXT_BASE_RPC_URL=https://sepolia.base.org
    $ export BASE_DEPLOYER_PRIVATE_KEY=0x...
    $ export OWNER_ADDRESS=0x...
    $ forge create \
        --rpc-url "$TWTXT_BASE_RPC_URL" \
        --private-key "$BASE_DEPLOYER_PRIVATE_KEY" \
        contracts/BaseTwtxt.sol:BaseTwtxt \
        --constructor-args "$OWNER_ADDRESS"

After deployment, set ``[base] contract`` and ``[base] from_block`` to the
deployment address and deployment block.

Publish a post
--------------

The CLI never stores a private key in the twtxt config. It reads the signing key
from ``TWTXT_BASE_PRIVATE_KEY`` by default:

.. code-block:: console

    $ export TWTXT_BASE_PRIVATE_KEY=0x...
    $ twtxt base-tweet "hello from Base"

Use ``--network base`` only when you intend to spend real ETH on Base Mainnet.
The command asks for confirmation unless ``--yes`` is passed.

Publish or inspect a profile
----------------------------

.. code-block:: console

    $ twtxt base-profile --nick alice --twturl https://example.org/alice.txt
    $ twtxt base-profile 0x0000000000000000000000000000000000000001

Follow and read Base accounts
-----------------------------

.. code-block:: console

    $ twtxt follow alice base://0x0000000000000000000000000000000000000001
    $ twtxt base-timeline alice
    $ twtxt timeline

``twtxt timeline`` includes Base-chain sources when ``[base] contract`` is set.

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
    $ export VITE_BASE_TWTXT_CONTRACT=0xYourDeployedContract
    $ export VITE_BASE_RPC_URL=https://sepolia.base.org
    $ export VITE_BASE_FROM_BLOCK=12345678
