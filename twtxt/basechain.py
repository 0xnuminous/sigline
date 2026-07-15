"""
    twtxt.basechain
    ~~~~~~~~~~~~~~~

    Base-chain helpers for publishing and reading twtxt events.

    :copyright: (c) 2016-2022 by buckket.
    :license: MIT, see LICENSE for more details.
"""

import os
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import urlparse

from eth_account import Account
from web3 import Web3
from web3.exceptions import Web3Exception

from twtxt.models import Tweet


PRIVATE_KEY_ENV = "SIGLINE_BASE_PRIVATE_KEY"
RPC_URL_ENV = "SIGLINE_BASE_RPC_URL"
CONTRACT_ENV = "SIGLINE_BASE_CONTRACT"
LEGACY_PRIVATE_KEY_ENV = "TWTXT_BASE_PRIVATE_KEY"
LEGACY_RPC_URL_ENV = "TWTXT_BASE_RPC_URL"
LEGACY_CONTRACT_ENV = "TWTXT_BASE_CONTRACT"
DEFAULT_NETWORK = "base-sepolia"
BASE_URL_PREFIX = "base://"
DEFAULT_LOG_CHUNK_SIZE = 2000
MAX_POST_BYTES = 140
PROFILE_URL_SCHEMES = ("http", "https")
ZERO_HASH = "0x" + ("0" * 64)
REF_KIND_NONE = 0
REF_KIND_REPLY = 1
REF_KIND_ECHO = 2


@dataclass(frozen=True)
class BaseNetwork:
    slug: str
    display_name: str
    chain_id: int
    rpc_url: str
    explorer_url: str


NETWORKS = {
    "base": BaseNetwork(
        slug="base",
        display_name="Base Mainnet",
        chain_id=8453,
        rpc_url="https://mainnet.base.org",
        explorer_url="https://base.blockscout.com",
    ),
    "base-mainnet": BaseNetwork(
        slug="base-mainnet",
        display_name="Base Mainnet",
        chain_id=8453,
        rpc_url="https://mainnet.base.org",
        explorer_url="https://base.blockscout.com",
    ),
    "base-sepolia": BaseNetwork(
        slug="base-sepolia",
        display_name="Base Sepolia",
        chain_id=84532,
        rpc_url="https://sepolia.base.org",
        explorer_url="https://sepolia-explorer.base.org",
    ),
    "sepolia": BaseNetwork(
        slug="sepolia",
        display_name="Base Sepolia",
        chain_id=84532,
        rpc_url="https://sepolia.base.org",
        explorer_url="https://sepolia-explorer.base.org",
    ),
}


SIGLINE_ABI = [
    {
        "type": "function",
        "name": "post",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "text", "type": "string"},
            {"name": "imageUri", "type": "string"},
            {"name": "imageHash", "type": "bytes32"},
        ],
        "outputs": [
            {"name": "index", "type": "uint256"},
            {"name": "contentHash", "type": "bytes32"},
        ],
    },
    {
        "type": "function",
        "name": "setProfile",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "nick", "type": "string"},
            {"name": "twtUrl", "type": "string"},
        ],
        "outputs": [],
    },
    {
        "type": "function",
        "name": "IMAGE_PASS_FEE",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"name": "", "type": "uint256"}],
    },
    {
        "type": "function",
        "name": "POST_TYPEHASH",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"name": "", "type": "bytes32"}],
    },
    {
        "type": "function",
        "name": "eip712Domain",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [
            {"name": "fields", "type": "bytes1"},
            {"name": "name", "type": "string"},
            {"name": "version", "type": "string"},
            {"name": "chainId", "type": "uint256"},
            {"name": "verifyingContract", "type": "address"},
            {"name": "salt", "type": "bytes32"},
            {"name": "extensions", "type": "uint256[]"},
        ],
    },
    {
        "type": "function",
        "name": "buyImagePass",
        "stateMutability": "payable",
        "inputs": [],
        "outputs": [],
    },
    {
        "type": "function",
        "name": "sweepFees",
        "stateMutability": "nonpayable",
        "inputs": [],
        "outputs": [],
    },
    {
        "type": "function",
        "name": "treasury",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"name": "", "type": "address"}],
    },
    {
        "type": "function",
        "name": "imagePasses",
        "stateMutability": "view",
        "inputs": [{"name": "account", "type": "address"}],
        "outputs": [{"name": "", "type": "bool"}],
    },
    {
        "type": "function",
        "name": "postWithReference",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "text", "type": "string"},
            {"name": "imageUri", "type": "string"},
            {"name": "imageHash", "type": "bytes32"},
            {"name": "refHash", "type": "bytes32"},
            {"name": "refKind", "type": "uint8"},
        ],
        "outputs": [
            {"name": "index", "type": "uint256"},
            {"name": "contentHash", "type": "bytes32"},
        ],
    },
    {
        "type": "function",
        "name": "profile",
        "stateMutability": "view",
        "inputs": [{"name": "account", "type": "address"}],
        "outputs": [
            {
                "name": "",
                "type": "tuple",
                "components": [
                    {"name": "nick", "type": "string"},
                    {"name": "twtUrl", "type": "string"},
                    {"name": "updatedAt", "type": "uint64"},
                ],
            }
        ],
    },
    {
        "type": "function",
        "name": "line",
        "stateMutability": "view",
        "inputs": [
            {"name": "account", "type": "address"},
            {"name": "index", "type": "uint256"},
        ],
        "outputs": [
            {
                "name": "",
                "type": "tuple",
                "components": [
                    {"name": "contentHash", "type": "bytes32"},
                    {"name": "createdAt", "type": "uint64"},
                    {"name": "imageHash", "type": "bytes32"},
                    {"name": "refHash", "type": "bytes32"},
                    {"name": "refKind", "type": "uint8"},
                ],
            }
        ],
    },
    {
        "type": "function",
        "name": "postCount",
        "stateMutability": "view",
        "inputs": [{"name": "account", "type": "address"}],
        "outputs": [{"name": "", "type": "uint256"}],
    },
    {
        "type": "event",
        "name": "PostPosted",
        "anonymous": False,
        "inputs": [
            {"indexed": True, "name": "author", "type": "address"},
            {"indexed": True, "name": "index", "type": "uint256"},
            {"indexed": True, "name": "refHash", "type": "bytes32"},
            {"indexed": False, "name": "createdAt", "type": "uint64"},
            {"indexed": False, "name": "contentHash", "type": "bytes32"},
            {"indexed": False, "name": "text", "type": "string"},
            {"indexed": False, "name": "imageUri", "type": "string"},
            {"indexed": False, "name": "imageHash", "type": "bytes32"},
            {"indexed": False, "name": "refKind", "type": "uint8"},
        ],
    },
    {
        "type": "event",
        "name": "ImagePassPurchased",
        "anonymous": False,
        "inputs": [
            {"indexed": True, "name": "account", "type": "address"},
            {"indexed": False, "name": "amount", "type": "uint256"},
        ],
    },
    {
        "type": "event",
        "name": "TreasurySwept",
        "anonymous": False,
        "inputs": [
            {"indexed": True, "name": "treasury", "type": "address"},
            {"indexed": False, "name": "amount", "type": "uint256"},
        ],
    },
]


class BaseChainError(Exception):
    """Base-chain operation failed."""


class BaseConfigurationError(BaseChainError):
    """Base-chain configuration is missing or invalid."""


def is_base_url(url):
    return bool(url and url.lower().startswith(BASE_URL_PREFIX))


def is_base_address(value):
    return bool(value and not is_base_url(value) and Web3.is_address(value.strip()))


def to_base_url(address):
    return "{0}{1}".format(BASE_URL_PREFIX, normalize_address(address))


def normalize_address(address):
    if not address:
        raise BaseConfigurationError("Base address is required.")

    raw_address = address[len(BASE_URL_PREFIX):] if is_base_url(address) else address
    raw_address = raw_address.strip()

    try:
        return Web3.to_checksum_address(raw_address)
    except (TypeError, ValueError) as e:
        raise BaseConfigurationError("Invalid Base address: {0}".format(address)) from e


def source_address(source):
    if not source or not is_base_url(source.url):
        raise BaseConfigurationError("Source is not a Base source.")
    return normalize_address(source.url)


def network_config(network):
    network = network or DEFAULT_NETWORK
    try:
        return NETWORKS[network]
    except KeyError as e:
        raise BaseConfigurationError("Unsupported Base network: {0}".format(network)) from e


def resolve_rpc_url(network, rpc_url=None):
    if rpc_url:
        return rpc_url
    env_rpc_url = os.environ.get(RPC_URL_ENV) or os.environ.get(LEGACY_RPC_URL_ENV)
    if env_rpc_url:
        return env_rpc_url
    return network_config(network).rpc_url


def resolve_contract_address(contract_address=None):
    contract_address = contract_address or os.environ.get(CONTRACT_ENV) or os.environ.get(LEGACY_CONTRACT_ENV)
    if not contract_address:
        raise BaseConfigurationError(
            "Base contract address is required. Set [base] contract or {0}.".format(CONTRACT_ENV)
        )
    return normalize_address(contract_address)


def connect(network=DEFAULT_NETWORK, rpc_url=None, timeout=5.0):
    cfg = network_config(network)
    endpoint = resolve_rpc_url(cfg.slug, rpc_url)
    request_kwargs = {"timeout": timeout} if timeout else None
    w3 = Web3(Web3.HTTPProvider(endpoint, request_kwargs=request_kwargs))

    try:
        is_connected = w3.is_connected()
    except (Web3Exception, ValueError) as e:
        raise BaseChainError("Could not connect to Base RPC endpoint: {0}".format(endpoint)) from e

    if not is_connected:
        raise BaseChainError("Could not connect to Base RPC endpoint: {0}".format(endpoint))

    try:
        actual_chain_id = w3.eth.chain_id
    except (Web3Exception, ValueError) as e:
        raise BaseChainError("Could not read Base RPC chain ID: {0}".format(e)) from e
    if actual_chain_id != cfg.chain_id:
        raise BaseChainError(
            "RPC chain ID mismatch: expected {0} for {1}, got {2}.".format(
                cfg.chain_id, cfg.display_name, actual_chain_id
            )
        )

    return w3, cfg


def contract_for(w3, contract_address):
    return w3.eth.contract(address=normalize_address(contract_address), abi=SIGLINE_ABI)


def get_profile(account, contract_address, network=DEFAULT_NETWORK, rpc_url=None, timeout=5.0):
    w3, _ = connect(network=network, rpc_url=rpc_url, timeout=timeout)
    contract = contract_for(w3, resolve_contract_address(contract_address))
    try:
        profile = contract.functions.profile(normalize_address(account)).call()
    except (Web3Exception, ValueError) as e:
        raise BaseChainError("Failed to fetch Base profile: {0}".format(e)) from e
    return {"nick": profile[0], "twturl": profile[1], "updated_at": profile[2]}


def get_line_pointer(account, index, contract_address, network=DEFAULT_NETWORK, rpc_url=None, timeout=5.0):
    line_index = _parse_block_number(index, "line index")
    w3, _ = connect(network=network, rpc_url=rpc_url, timeout=timeout)
    contract = contract_for(w3, resolve_contract_address(contract_address))
    try:
        line = contract.functions.line(normalize_address(account), line_index).call()
    except (Web3Exception, ValueError) as e:
        raise BaseChainError("Failed to fetch Base line pointer: {0}".format(e)) from e
    return {
        "content_hash": Web3.to_hex(line[0]),
        "created_at": line[1],
        "image_hash": Web3.to_hex(line[2]),
        "ref_hash": Web3.to_hex(line[3]),
        "ref_kind": line[4],
    }


def get_base_tweets(sources, contract_address, network=DEFAULT_NETWORK, rpc_url=None,
                    from_block=0, to_block="latest", timeout=5.0, limit=None,
                    chunk_size=DEFAULT_LOG_CHUNK_SIZE):
    w3, _ = connect(network=network, rpc_url=rpc_url, timeout=timeout)
    contract = contract_for(w3, resolve_contract_address(contract_address))
    tweets = []

    for source in sources:
        address = source_address(source)
        entries = _get_tweet_logs(
            w3,
            contract,
            address,
            from_block=from_block,
            to_block=to_block,
            chunk_size=chunk_size,
            limit=limit,
        )
        for entry in entries:
            args = entry["args"]
            created_at = datetime.fromtimestamp(args["createdAt"], timezone.utc)
            tweets.append(Tweet(_base_event_text(args), created_at, source))

    tweets = sorted(tweets, reverse=True)
    return tweets[:limit] if limit else tweets


def _base_event_text(args):
    text = args.get("text") or ""
    ref_prefix = _event_ref_prefix(args)
    image_uri = args.get("imageUri") or ""

    parts = []
    if ref_prefix:
        parts.append(ref_prefix)
    if text:
        parts.append(text)
    if image_uri:
        parts.append("[image] {0}".format(image_uri))

    return " ".join(parts) if parts else "[empty Base post]"


def _event_ref_prefix(args):
    ref_hash = _event_ref_hash(args)
    ref_kind = args.get("refKind") or REF_KIND_NONE
    if ref_kind == REF_KIND_REPLY and ref_hash != ZERO_HASH:
        return "[reply] {0}".format(_short_hash(ref_hash))
    if ref_kind == REF_KIND_ECHO and ref_hash != ZERO_HASH:
        return "[echo] {0}".format(_short_hash(ref_hash))
    return ""


def _event_ref_hash(args):
    value = args.get("refHash") or ZERO_HASH
    return Web3.to_hex(value) if isinstance(value, (bytes, bytearray)) else str(value)


def _short_hash(value):
    return "{0}…{1}".format(value[:8], value[-4:]) if len(value) > 12 else value


def publish_tweet(text, contract_address, network=DEFAULT_NETWORK, rpc_url=None,
                  private_key_env=PRIVATE_KEY_ENV, timeout=120):
    text_length = len(text.encode("utf-8"))
    if text_length > MAX_POST_BYTES:
        raise BaseConfigurationError(
            "Base post is too long: {0} bytes exceeds the {1} byte limit.".format(text_length, MAX_POST_BYTES)
        )
    contract, account, cfg, w3 = _transaction_context(
        contract_address=contract_address,
        network=network,
        rpc_url=rpc_url,
        private_key_env=private_key_env,
        timeout=timeout,
    )
    return _send_transaction(w3, cfg, account, contract.functions.post(text, "", b"\x00" * 32), timeout=timeout)


def set_profile(nick, twturl, contract_address, network=DEFAULT_NETWORK, rpc_url=None,
                private_key_env=PRIVATE_KEY_ENV, timeout=120):
    twturl = _validate_profile_url(twturl)
    contract, account, cfg, w3 = _transaction_context(
        contract_address=contract_address,
        network=network,
        rpc_url=rpc_url,
        private_key_env=private_key_env,
        timeout=timeout,
    )
    return _send_transaction(w3, cfg, account, contract.functions.setProfile(nick, twturl), timeout=timeout)


def account_from_env(env_name=PRIVATE_KEY_ENV):
    private_key = os.environ.get(env_name)
    if not private_key and env_name == PRIVATE_KEY_ENV:
        private_key = os.environ.get(LEGACY_PRIVATE_KEY_ENV)
    if not private_key:
        raise BaseConfigurationError(
            "Private key env var {0} is not set. The key is only read from the environment.".format(env_name)
        )
    private_key = private_key.strip()
    if not private_key.startswith("0x"):
        private_key = "0x{0}".format(private_key)
    try:
        return Account.from_key(private_key)
    except (TypeError, ValueError) as e:
        raise BaseConfigurationError("Private key env var {0} is invalid.".format(env_name)) from e


def _transaction_context(contract_address, network, rpc_url, private_key_env, timeout):
    w3, cfg = connect(network=network, rpc_url=rpc_url, timeout=timeout)
    contract = contract_for(w3, resolve_contract_address(contract_address))
    account = account_from_env(private_key_env)
    return contract, account, cfg, w3


def _send_transaction(w3, cfg, account, contract_function, timeout):
    try:
        tx_base = {
            "from": account.address,
            "chainId": cfg.chain_id,
            "nonce": w3.eth.get_transaction_count(account.address, "pending"),
        }
        tx_base.update(_fee_parameters(w3))
        tx_base["gas"] = _estimate_gas(contract_function, tx_base)

        tx = contract_function.build_transaction(tx_base)
        signed = account.sign_transaction(tx)
        tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=timeout)
    except BaseChainError:
        raise
    except (Web3Exception, ValueError, TimeoutError) as e:
        raise BaseChainError("Failed to submit Base transaction: {0}".format(e)) from e

    if receipt.get("status") != 1:
        raise BaseChainError("Base transaction reverted: {0}".format(_format_tx_hash(tx_hash)))

    return {"tx_hash": _format_tx_hash(tx_hash), "receipt": receipt, "account": account.address}


def _get_tweet_logs(w3, contract, address, from_block=0, to_block="latest",
                    chunk_size=DEFAULT_LOG_CHUNK_SIZE, limit=None):
    argument_filters = {"author": address}
    if not chunk_size:
        return _fetch_tweet_logs(
            contract,
            _parse_block_number(from_block, "from_block"),
            _resolve_to_block(w3, to_block),
            argument_filters,
        )

    start = _parse_block_number(from_block, "from_block")
    end = _resolve_to_block(w3, to_block)
    if start > end:
        return []

    entries = []
    cursor_end = end
    while cursor_end >= start:
        cursor_start = max(start, cursor_end - chunk_size + 1)
        entries.extend(_fetch_tweet_logs(contract, cursor_start, cursor_end, argument_filters))
        if limit and len(entries) >= limit:
            break
        cursor_end = cursor_start - 1
    return entries


def _fetch_tweet_logs(contract, from_block, to_block, argument_filters):
    try:
        return contract.events.PostPosted.get_logs(
            from_block=from_block,
            to_block=to_block,
            argument_filters=argument_filters,
        )
    except (Web3Exception, ValueError) as e:
        raise BaseChainError("Failed to fetch posts from Base: {0}".format(e)) from e


def _resolve_to_block(w3, to_block):
    if to_block == "latest":
        try:
            return w3.eth.block_number
        except (Web3Exception, ValueError) as e:
            raise BaseChainError("Failed to read latest Base block: {0}".format(e)) from e
    return _parse_block_number(to_block, "to_block")


def _format_tx_hash(tx_hash):
    return Web3.to_hex(tx_hash)


def _validate_profile_url(twturl):
    if not twturl:
        return twturl

    twturl = twturl.strip()
    parsed = urlparse(twturl)
    if parsed.scheme not in PROFILE_URL_SCHEMES or not parsed.netloc:
        raise BaseConfigurationError("Base profile twturl must be an http:// or https:// URL.")
    return twturl


def _parse_block_number(value, label):
    try:
        block_number = int(value or 0)
    except (TypeError, ValueError) as e:
        raise BaseConfigurationError("Invalid Base {0}: {1}".format(label, value)) from e

    if block_number < 0:
        raise BaseConfigurationError("Invalid Base {0}: {1}".format(label, value))
    return block_number


def _fee_parameters(w3):
    try:
        priority_fee = w3.eth.max_priority_fee
    except (AttributeError, Web3Exception, ValueError):
        priority_fee = w3.to_wei("0.01", "gwei")

    latest_block = w3.eth.get_block("latest")
    base_fee = latest_block.get("baseFeePerGas")

    if base_fee is None:
        return {"gasPrice": w3.eth.gas_price}

    return {
        "type": 2,
        "maxPriorityFeePerGas": priority_fee,
        "maxFeePerGas": (base_fee * 2) + priority_fee,
    }


def _estimate_gas(contract_function, tx_base):
    estimated = contract_function.estimate_gas(tx_base)
    return int(estimated * 1.2)
