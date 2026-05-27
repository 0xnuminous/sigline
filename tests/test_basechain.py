import os
from types import SimpleNamespace

import pytest
from web3.exceptions import Web3Exception

from twtxt.basechain import BaseChainError, BaseConfigurationError, account_from_env
from twtxt.basechain import get_base_tweets, get_line_pointer, get_profile, network_config, publish_tweet
from twtxt.basechain import normalize_address, resolve_rpc_url, to_base_url
from twtxt.basechain import _send_transaction
from twtxt.models import Source


def test_network_config():
    assert network_config("base").chain_id == 8453
    assert network_config("base-sepolia").chain_id == 84532

    with pytest.raises(BaseConfigurationError):
        network_config("ethereum")


def test_normalize_base_address():
    address = "0x0000000000000000000000000000000000000001"
    assert normalize_address(address) == "0x0000000000000000000000000000000000000001"
    assert to_base_url(address) == "base://0x0000000000000000000000000000000000000001"

    with pytest.raises(BaseConfigurationError):
        normalize_address("not-an-address")


def test_resolve_rpc_url_prefers_explicit_and_env(monkeypatch):
    monkeypatch.delenv("TWTXT_BASE_RPC_URL", raising=False)
    monkeypatch.delenv("SIGLINE_BASE_RPC_URL", raising=False)
    assert resolve_rpc_url("base-sepolia") == "https://sepolia.base.org"
    assert resolve_rpc_url("base-sepolia", "https://rpc.example") == "https://rpc.example"

    monkeypatch.setenv("SIGLINE_BASE_RPC_URL", "https://env-rpc.example")
    assert resolve_rpc_url("base-sepolia") == os.environ["SIGLINE_BASE_RPC_URL"]

    monkeypatch.delenv("SIGLINE_BASE_RPC_URL")
    monkeypatch.setenv("TWTXT_BASE_RPC_URL", "https://legacy-rpc.example")
    assert resolve_rpc_url("base-sepolia") == os.environ["TWTXT_BASE_RPC_URL"]


def test_account_from_env_rejects_missing_or_invalid_key(monkeypatch):
    monkeypatch.delenv("TWTXT_BASE_PRIVATE_KEY", raising=False)
    monkeypatch.delenv("SIGLINE_BASE_PRIVATE_KEY", raising=False)
    with pytest.raises(BaseConfigurationError):
        account_from_env()

    monkeypatch.setenv("SIGLINE_BASE_PRIVATE_KEY", "not-a-key")
    with pytest.raises(BaseConfigurationError):
        account_from_env()


def test_publish_tweet_rejects_posts_over_original_twitter_limit(monkeypatch):
    def fail_transaction_context(*args, **kwargs):
        raise AssertionError("oversized posts should fail before RPC setup")

    monkeypatch.setattr("twtxt.basechain._transaction_context", fail_transaction_context)

    with pytest.raises(BaseConfigurationError, match="141 bytes exceeds the 140 byte limit"):
        publish_tweet("x" * 141, "0x0000000000000000000000000000000000000001")


class FakeEth:
    def __init__(self, block_number=0, receipt=None, tx_hash=None, send_error=None, wait_error=None):
        self.block_number = block_number
        self.receipt = receipt or {"status": 1}
        self.tx_hash = tx_hash or bytes.fromhex("ab" * 32)
        self.send_error = send_error
        self.wait_error = wait_error

    @property
    def max_priority_fee(self):
        return 1

    def get_block(self, block_identifier):
        assert block_identifier == "latest"
        return {"baseFeePerGas": 10}

    def get_transaction_count(self, address, block_identifier):
        assert block_identifier == "pending"
        return 7

    def send_raw_transaction(self, raw_transaction):
        if self.send_error:
            raise self.send_error
        return self.tx_hash

    def wait_for_transaction_receipt(self, tx_hash, timeout):
        if self.wait_error:
            raise self.wait_error
        return self.receipt


class FakeWeb3:
    def __init__(self, block_number=0, receipt=None, tx_hash=None, send_error=None, wait_error=None):
        self.eth = FakeEth(
            block_number=block_number,
            receipt=receipt,
            tx_hash=tx_hash,
            send_error=send_error,
            wait_error=wait_error,
        )

    def to_wei(self, amount, unit):
        assert unit == "gwei"
        return 1


class FakePostPosted:
    def __init__(self, logs_by_range=None, error=None):
        self.logs_by_range = logs_by_range or {}
        self.error = error
        self.calls = []

    def get_logs(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return self.logs_by_range.get((kwargs["from_block"], kwargs["to_block"]), [])


class FakeContract:
    def __init__(self, tweet_posted=None, functions=None):
        self.events = SimpleNamespace(PostPosted=tweet_posted)
        self.functions = functions


def _patch_base_contract(monkeypatch, w3, contract):
    monkeypatch.setattr("twtxt.basechain.connect", lambda **kwargs: (w3, None))
    monkeypatch.setattr("twtxt.basechain.contract_for", lambda w3_arg, address: contract)


def test_get_base_tweets_pages_log_reads_from_latest_chunk_first(monkeypatch):
    address = "0x0000000000000000000000000000000000000001"
    source = Source("alice", to_base_url(address))
    tweet_posted = FakePostPosted(
        {
            (16, 25): [{"args": {"createdAt": 25, "text": "newest"}}],
            (0, 5): [{"args": {"createdAt": 5, "text": "oldest"}}],
        }
    )
    w3 = FakeWeb3(block_number=25)
    _patch_base_contract(monkeypatch, w3, FakeContract(tweet_posted=tweet_posted))

    tweets = get_base_tweets(
        [source],
        contract_address=address,
        from_block=0,
        to_block="latest",
        chunk_size=10,
    )

    assert [tweet.text for tweet in tweets] == ["newest", "oldest"]
    assert [(call["from_block"], call["to_block"]) for call in tweet_posted.calls] == [
        (16, 25),
        (6, 15),
        (0, 5),
    ]


def test_get_base_tweets_allows_image_only_posts(monkeypatch):
    address = "0x0000000000000000000000000000000000000001"
    image_uri = "ipfs://bafkreic6encph7qzqg3qg6xv4vl23s7lux7dxry4g6e5fli7dgc7alnlti"
    source = Source("alice", to_base_url(address))
    tweet_posted = FakePostPosted(
        {
            (0, 10): [
                {
                    "args": {
                        "createdAt": 10,
                        "text": "",
                        "imageUri": image_uri,
                    }
                }
            ],
        }
    )
    w3 = FakeWeb3(block_number=10)
    _patch_base_contract(monkeypatch, w3, FakeContract(tweet_posted=tweet_posted))

    tweets = get_base_tweets(
        [source],
        contract_address=address,
        from_block=0,
        to_block=10,
        chunk_size=0,
    )

    assert [tweet.text for tweet in tweets] == ["[image] {0}".format(image_uri)]


def test_get_base_tweets_wraps_rpc_errors(monkeypatch):
    address = "0x0000000000000000000000000000000000000001"
    source = Source("alice", to_base_url(address))
    tweet_posted = FakePostPosted(error=Web3Exception("block range too large"))
    w3 = FakeWeb3(block_number=25)
    _patch_base_contract(monkeypatch, w3, FakeContract(tweet_posted=tweet_posted))

    with pytest.raises(BaseChainError, match="Failed to fetch posts from Base"):
        get_base_tweets([source], contract_address=address, chunk_size=10)


class FakeProfileCall:
    def __init__(self, error=None):
        self.error = error

    def call(self):
        if self.error:
            raise self.error
        return ("alice", "https://example.com/twtxt.txt", 123)


class FakeProfileFunctions:
    def __init__(self, error=None):
        self.error = error

    def profile(self, account):
        return FakeProfileCall(error=self.error)


def test_get_profile_wraps_web3_errors(monkeypatch):
    address = "0x0000000000000000000000000000000000000001"
    w3 = FakeWeb3()
    contract = FakeContract(
        tweet_posted=FakePostPosted(),
        functions=FakeProfileFunctions(error=Web3Exception("no code at address")),
    )
    _patch_base_contract(monkeypatch, w3, contract)

    with pytest.raises(BaseChainError, match="Failed to fetch Base profile"):
        get_profile(address, contract_address=address)


class FakeLineCall:
    def __init__(self, value=None, error=None):
        self.value = value or (b"\x12" * 32, 123, b"\x34" * 32)
        self.error = error

    def call(self):
        if self.error:
            raise self.error
        return self.value


class FakeLineFunctions:
    def __init__(self, error=None):
        self.error = error

    def line(self, account, index):
        assert account == "0x0000000000000000000000000000000000000001"
        assert index == 2
        return FakeLineCall(error=self.error)


def test_get_line_pointer_returns_prefixed_hashes(monkeypatch):
    address = "0x0000000000000000000000000000000000000001"
    w3 = FakeWeb3()
    contract = FakeContract(tweet_posted=FakePostPosted(), functions=FakeLineFunctions())
    _patch_base_contract(monkeypatch, w3, contract)

    line = get_line_pointer(address, 2, contract_address=address)

    assert line == {
        "content_hash": "0x" + ("12" * 32),
        "created_at": 123,
        "image_hash": "0x" + ("34" * 32),
    }


def test_get_line_pointer_wraps_web3_errors(monkeypatch):
    address = "0x0000000000000000000000000000000000000001"
    w3 = FakeWeb3()
    contract = FakeContract(
        tweet_posted=FakePostPosted(),
        functions=FakeLineFunctions(error=Web3Exception("execution reverted")),
    )
    _patch_base_contract(monkeypatch, w3, contract)

    with pytest.raises(BaseChainError, match="Failed to fetch Base line pointer"):
        get_line_pointer(address, 2, contract_address=address)


def test_get_line_pointer_rejects_invalid_index(monkeypatch):
    address = "0x0000000000000000000000000000000000000001"

    def fail_connect(**kwargs):
        raise AssertionError("invalid indexes should fail before RPC setup")

    monkeypatch.setattr("twtxt.basechain.connect", fail_connect)

    with pytest.raises(BaseConfigurationError, match="Invalid Base line index"):
        get_line_pointer(address, -1, contract_address=address)


class FakeAccount:
    address = "0x0000000000000000000000000000000000000001"

    def sign_transaction(self, tx):
        return SimpleNamespace(raw_transaction=b"signed")


class FakeContractFunction:
    def __init__(self, estimate_error=None):
        self.estimate_error = estimate_error

    def estimate_gas(self, tx_base):
        if self.estimate_error:
            raise self.estimate_error
        return 21000

    def build_transaction(self, tx_base):
        return tx_base


def test_send_transaction_returns_prefixed_tx_hash():
    result = _send_transaction(
        FakeWeb3(),
        SimpleNamespace(chain_id=84532),
        FakeAccount(),
        FakeContractFunction(),
        timeout=1,
    )

    assert result["tx_hash"].startswith("0x")
    assert len(result["tx_hash"]) == 66


def test_send_transaction_revert_uses_prefixed_tx_hash():
    with pytest.raises(BaseChainError, match="0xabab"):
        _send_transaction(
            FakeWeb3(receipt={"status": 0}),
            SimpleNamespace(chain_id=84532),
            FakeAccount(),
            FakeContractFunction(),
            timeout=1,
        )


def test_send_transaction_wraps_web3_errors():
    with pytest.raises(BaseChainError, match="Failed to submit Base transaction"):
        _send_transaction(
            FakeWeb3(send_error=Web3Exception("nonce too low")),
            SimpleNamespace(chain_id=84532),
            FakeAccount(),
            FakeContractFunction(),
            timeout=1,
        )


def test_send_transaction_wraps_estimate_gas_errors():
    with pytest.raises(BaseChainError, match="Failed to submit Base transaction"):
        _send_transaction(
            FakeWeb3(),
            SimpleNamespace(chain_id=84532),
            FakeAccount(),
            FakeContractFunction(estimate_error=Web3Exception("execution reverted")),
            timeout=1,
        )


def test_send_transaction_wraps_receipt_wait_errors():
    with pytest.raises(BaseChainError, match="Failed to submit Base transaction"):
        _send_transaction(
            FakeWeb3(wait_error=Web3Exception("timeout")),
            SimpleNamespace(chain_id=84532),
            FakeAccount(),
            FakeContractFunction(),
            timeout=1,
        )
