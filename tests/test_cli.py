import configparser
from datetime import datetime, timezone

from click.testing import CliRunner

from twtxt.basechain import to_base_url
from twtxt.cli import cli
from twtxt.config import Config
from twtxt.models import Tweet


ADDRESS = "0x0000000000000000000000000000000000000001"


def _write_config(tmp_path, following=None, base=None, twturl="https://example.test/me.txt"):
    twtfile = tmp_path / "twtxt.txt"
    twtfile.write_text("")

    cfg = configparser.ConfigParser()
    cfg.add_section("twtxt")
    cfg.set("twtxt", "nick", "me")
    cfg.set("twtxt", "twtfile", str(twtfile))
    if twturl is not None:
        cfg.set("twtxt", "twturl", twturl)
    cfg.set("twtxt", "use_cache", "False")

    cfg.add_section("following")
    for nick, url in (following or {}).items():
        cfg.set("following", nick, url)

    if base:
        cfg.add_section("base")
        for key, value in base.items():
            cfg.set("base", key, str(value))

    cfg_path = tmp_path / "config"
    with cfg_path.open("w") as config_file:
        cfg.write(config_file)
    return str(cfg_path)


def test_timeline_source_prefers_followed_0x_nick(monkeypatch, tmp_path):
    cfg_path = _write_config(tmp_path, following={"0xdoe": "https://example.test/0xdoe.txt"})
    seen = {}

    def fail_normalize_address(value):
        raise AssertionError("timeline should resolve followed nicks before Base address parsing")

    def fake_get_remote_tweets(sources, limit=None, timeout=5.0, cache=None):
        seen["sources"] = sources
        created_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
        return [Tweet("from followed 0x nick", created_at, sources[0])]

    def fail_get_base_tweets(*args, **kwargs):
        raise AssertionError("timeline should not treat a followed 0x nick as a raw Base address")

    monkeypatch.setattr("twtxt.cli.normalize_address", fail_normalize_address)
    monkeypatch.setattr("twtxt.cli.get_remote_tweets", fake_get_remote_tweets)
    monkeypatch.setattr("twtxt.cli.get_base_tweets", fail_get_base_tweets)

    result = CliRunner().invoke(
        cli,
        ["--config", cfg_path, "timeline", "--no-cache", "--source", "0xdoe", "--porcelain"],
    )

    assert result.exit_code == 0, result.output
    assert seen["sources"][0].nick == "0xdoe"
    assert seen["sources"][0].url == "https://example.test/0xdoe.txt"
    assert "from followed 0x nick" in result.output


def test_timeline_invalid_raw_0x_source_falls_back_to_url(monkeypatch, tmp_path):
    cfg_path = _write_config(tmp_path)
    seen = {}

    def fake_get_remote_tweets(sources, limit=None, timeout=5.0, cache=None):
        seen["sources"] = sources
        return []

    def fail_get_base_tweets(*args, **kwargs):
        raise AssertionError("invalid raw 0x input should not be queried as Base")

    def fail_source_from_base_input(*args, **kwargs):
        raise AssertionError("invalid raw 0x input should not be parsed as a Base source")

    monkeypatch.setattr("twtxt.cli.get_remote_tweets", fake_get_remote_tweets)
    monkeypatch.setattr("twtxt.cli.get_base_tweets", fail_get_base_tweets)
    monkeypatch.setattr("twtxt.cli._source_from_base_input", fail_source_from_base_input)

    result = CliRunner().invoke(
        cli,
        ["--config", cfg_path, "timeline", "--no-cache", "--source", "0xabc"],
    )

    assert result.exit_code == 0, result.output
    assert "Traceback" not in result.output
    assert seen["sources"][0].nick == "0xabc"
    assert seen["sources"][0].url == "0xabc"


def test_timeline_raw_base_source_accepts_from_block(monkeypatch, tmp_path):
    cfg_path = _write_config(tmp_path, base={"from_block": 7})
    seen = {}

    def fake_get_base_tweets(sources, contract_address, **kwargs):
        seen["sources"] = sources
        seen["kwargs"] = kwargs
        return []

    monkeypatch.setattr("twtxt.cli.get_base_tweets", fake_get_base_tweets)

    result = CliRunner().invoke(
        cli,
        ["--config", cfg_path, "timeline", "--no-cache", "--source", ADDRESS, "--from-block", "123"],
    )

    assert result.exit_code == 0, result.output
    assert seen["sources"][0].is_base is True
    assert seen["sources"][0].url == to_base_url(ADDRESS)
    assert seen["kwargs"]["from_block"] == 123


def test_follow_converts_valid_raw_base_address(tmp_path):
    cfg_path = _write_config(tmp_path)

    result = CliRunner().invoke(cli, ["--config", cfg_path, "follow", "--force", "alice", ADDRESS])

    assert result.exit_code == 0, result.output
    assert Config.from_file(cfg_path).get_source_by_nick("alice").url == to_base_url(ADDRESS)


def test_follow_invalid_raw_0x_is_not_forced_into_base(tmp_path):
    cfg_path = _write_config(tmp_path)

    result = CliRunner().invoke(cli, ["--config", cfg_path, "follow", "--force", "alice", "0xabc"])

    assert result.exit_code == 0, result.output
    assert Config.from_file(cfg_path).get_source_by_nick("alice").url == "0xabc"


def test_follow_invalid_base_url_still_validates(tmp_path):
    cfg_path = _write_config(tmp_path)

    result = CliRunner().invoke(cli, ["--config", cfg_path, "follow", "--force", "alice", "base://0xabc"])

    assert result.exit_code != 0
    assert "Invalid Base address: base://0xabc" in result.output


def test_base_tweet_does_not_expand_mentions(monkeypatch, tmp_path):
    cfg_path = _write_config(tmp_path, following={"bob": "https://example.test/bob.txt"})
    seen = {}

    def fake_publish_tweet(text, contract_address, **kwargs):
        seen["text"] = text
        return {"tx_hash": "0x01"}

    monkeypatch.setattr("twtxt.cli.publish_tweet", fake_publish_tweet)

    result = CliRunner().invoke(cli, ["--config", cfg_path, "base-tweet", "hello", "@bob"])

    assert result.exit_code == 0, result.output
    assert seen["text"] == "hello @bob"


def test_base_profile_requires_twturl_when_config_has_none(monkeypatch, tmp_path):
    cfg_path = _write_config(tmp_path, twturl=None)

    def fail_set_profile(*args, **kwargs):
        raise AssertionError("base-profile should not publish an empty twturl")

    monkeypatch.setattr("twtxt.cli.set_profile", fail_set_profile)

    result = CliRunner().invoke(cli, ["--config", cfg_path, "base-profile", "--nick", "alice"])

    assert result.exit_code != 0
    assert "Base profile twturl is required" in result.output
