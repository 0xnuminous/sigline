"""
    twtxt.cli
    ~~~~~~~~~

    This module implements the command-line interface of twtxt.

    :copyright: (c) 2016-2022 by buckket.
    :license: MIT, see LICENSE for more details.
"""

import logging
import os
import shutil
import sys
import textwrap
from itertools import chain

import click

from twtxt.cache import Cache
from twtxt.basechain import BaseChainError, BaseConfigurationError
from twtxt.basechain import DEFAULT_NETWORK, NETWORKS, PRIVATE_KEY_ENV
from twtxt.basechain import get_base_tweets, get_profile, is_base_address, is_base_url, normalize_address
from twtxt.basechain import publish_tweet, set_profile, to_base_url
from twtxt.config import Config
from twtxt.helper import run_pre_tweet_hook, run_post_tweet_hook
from twtxt.helper import sort_and_truncate_tweets
from twtxt.helper import style_timeline, style_source, style_source_with_status
from twtxt.helper import validate_created_at, validate_text, validate_config_key
from twtxt.log import init_logging
from twtxt.mentions import expand_mentions
from twtxt.models import Tweet, Source
from twtxt.twfile import get_local_tweets, add_local_tweet
from twtxt.twhttp import get_remote_tweets, get_remote_status

logger = logging.getLogger(__name__)


def _split_sources_by_transport(sources):
    base_sources = [source for source in sources if source.is_base]
    http_sources = [source for source in sources if not source.is_base]
    return http_sources, base_sources


def _base_options(conf, network, rpc_url, contract):
    return {
        "network": network or conf.base_network or DEFAULT_NETWORK,
        "rpc_url": rpc_url or conf.base_rpc_url,
        "contract_address": contract or conf.base_contract,
    }


def _base_from_block(conf, from_block):
    return conf.base_from_block if from_block is None else from_block


def _confirm_mainnet(network, yes):
    if network in ("base", "base-mainnet") and not yes:
        click.confirm("➤ This writes to Base Mainnet and will spend real ETH for gas. Continue?",
                      default=False, abort=True)


def _source_from_base_input(conf, value):
    source = conf.get_source_by_nick(value)
    if source and source.is_base:
        return source

    address = normalize_address(value)
    nick = address[2:10].lower()
    return Source(nick, to_base_url(address))


def _base_sources_from_args(conf, values):
    if not values:
        return [source for source in conf.following if source.is_base]

    sources = []
    for value in values:
        sources.append(_source_from_base_input(conf, value))
    return sources


def _render_base_error(error):
    click.echo("✗ Base error: {0}".format(error), err=True)


@click.group()
@click.option("--config", "-c",
              type=click.Path(exists=True, file_okay=True, readable=True, writable=True, resolve_path=True),
              help="Specify a custom config file location.")
@click.option("--verbose", "-v",
              is_flag=True, default=False,
              help="Enable verbose output for debugging purposes.")
@click.version_option()
@click.pass_context
def cli(ctx, config, verbose):
    """Decentralised, minimalist microblogging service for hackers."""
    init_logging(debug=verbose)

    if ctx.invoked_subcommand == "quickstart":
        return  # Skip initializing config file

    try:
        if config:
            conf = Config.from_file(config)
        else:
            conf = Config.discover()
    except ValueError as e:
        if "Error in config file." in str(e):
            click.echo("✗ Please correct the errors mentioned above an run twtxt again.")
        else:
            click.echo("✗ Config file not found or not readable. You may want to run twtxt quickstart.")
        sys.exit()

    ctx.default_map = conf.build_default_map()
    ctx.obj = {'conf': conf}


@cli.command()
@click.option("--created-at",
              callback=validate_created_at,
              help="ISO 8601 formatted datetime string to use in Tweet, instead of current time.")
@click.option("--twtfile", "-f",
              type=click.Path(file_okay=True, writable=True, resolve_path=True),
              help="Location of your twtxt file. (Default: twtxt.txt)")
@click.argument("text", callback=validate_text, nargs=-1)
@click.pass_context
def tweet(ctx, created_at, twtfile, text):
    """Append a new tweet to your twtxt file."""
    text = expand_mentions(text)
    tweet = Tweet(text, created_at) if created_at else Tweet(text)

    pre_tweet_hook = ctx.obj["conf"].pre_tweet_hook
    if pre_tweet_hook:
        run_pre_tweet_hook(pre_tweet_hook, ctx.obj["conf"].options)

    if not add_local_tweet(tweet, twtfile):
        click.echo("✗ Couldn’t write to file.")
    else:
        post_tweet_hook = ctx.obj["conf"].post_tweet_hook
        if post_tweet_hook:
            run_post_tweet_hook(post_tweet_hook, ctx.obj["conf"].options)


@cli.command()
@click.option("--pager/--no-pager",
              is_flag=True,
              help="Use a pager to display content. (Default: False)")
@click.option("--limit", "-l",
              type=click.INT,
              help="Limit total number of shown tweets. (Default: 20)")
@click.option("--twtfile", "-f",
              type=click.Path(exists=True, file_okay=True, readable=True, resolve_path=True),
              help="Location of your twtxt file. (Default: twtxt.txt")
@click.option("--ascending", "sorting",
              flag_value="ascending",
              help="Sort timeline in ascending order.")
@click.option("--descending", "sorting",
              flag_value="descending",
              help="Sort timeline in descending order. (Default)")
@click.option("--timeout",
              type=click.FLOAT,
              help="Maximum time requests are allowed to take. (Default: 5.0)")
@click.option("--porcelain",
              is_flag=True,
              help="Style output in an easy-to-parse format. (Default: False)")
@click.option("--source", "-s",
              help="Only show feed of the given source. (Can be nick or URL)")
@click.option("--cache/--no-cache",
              is_flag=True,
              help="Cache remote twtxt files locally. (Default: True)")
@click.option("--force-update",
              is_flag=True,
              help="Force update even if cache is up-to-date. (Default: False)")
@click.option("--from-block",
              type=click.INT,
              help="First Base block to scan. Defaults to [base] from_block.")
@click.pass_context
def timeline(ctx, pager, limit, twtfile, sorting, timeout, porcelain, source, cache, force_update, from_block):
    """Retrieve your personal timeline."""
    if source:
        source_obj = ctx.obj["conf"].get_source_by_nick(source)
        if not source_obj and (is_base_url(source) or is_base_address(source)):
            try:
                source_obj = _source_from_base_input(ctx.obj["conf"], source)
            except BaseConfigurationError:
                source_obj = None
        if not source_obj:
            logger.debug("Not following {0}, trying as URL".format(source))
            source_obj = Source(source, source)
        sources = [source_obj]
    else:
        sources = ctx.obj["conf"].following

    http_sources, base_sources = _split_sources_by_transport(sources)
    tweets = []

    if cache and http_sources:
        try:
            with Cache.discover(update_interval=ctx.obj["conf"].timeline_update_interval) as cache:
                force_update = force_update or not cache.is_valid
                if force_update:
                    tweets = get_remote_tweets(http_sources, limit, timeout, cache)
                else:
                    logger.debug("Multiple calls to 'timeline' within {0} seconds. Skipping update".format(
                        cache.update_interval))
                    # Behold, almighty list comprehensions! (I might have gone overboard here…)
                    tweets = list(chain.from_iterable([cache.get_tweets(source.url) for source in http_sources]))
        except OSError as e:
            logger.debug(e)
            tweets = get_remote_tweets(http_sources, limit, timeout)
    elif http_sources:
        tweets = get_remote_tweets(http_sources, limit, timeout)

    if base_sources:
        try:
            tweets.extend(get_base_tweets(
                base_sources,
                ctx.obj["conf"].base_contract,
                network=ctx.obj["conf"].base_network,
                rpc_url=ctx.obj["conf"].base_rpc_url,
                from_block=_base_from_block(ctx.obj["conf"], from_block),
                timeout=timeout,
                limit=limit,
            ))
        except BaseChainError as e:
            _render_base_error(e)

    if twtfile and not source:
        source = Source(ctx.obj["conf"].nick, ctx.obj["conf"].twturl, file=twtfile)
        tweets.extend(get_local_tweets(source, limit))

    if not tweets:
        return

    tweets = sort_and_truncate_tweets(tweets, sorting, limit)

    if pager:
        click.echo_via_pager(style_timeline(tweets, porcelain))
    else:
        click.echo(style_timeline(tweets, porcelain))


@cli.command()
@click.option("--pager/--no-pager",
              is_flag=True,
              help="Use a pager to display content. (Default: False)")
@click.option("--limit", "-l",
              type=click.INT,
              help="Limit total number of shown tweets. (Default: 20)")
@click.option("--ascending", "sorting",
              flag_value="ascending",
              help="Sort timeline in ascending order.")
@click.option("--descending", "sorting",
              flag_value="descending",
              help="Sort timeline in descending order. (Default)")
@click.option("--timeout",
              type=click.FLOAT,
              help="Maximum time requests are allowed to take. (Default: 5.0)")
@click.option("--porcelain",
              is_flag=True,
              help="Style output in an easy-to-parse format. (Default: False)")
@click.option("--cache/--no-cache",
              is_flag=True,
              help="Cache remote twtxt files locally. (Default: True)")
@click.option("--force-update",
              is_flag=True,
              help="Force update even if cache is up-to-date. (Default: False)")
@click.argument("source")
@click.pass_context
def view(ctx, **kwargs):
    """Show feed of given source."""
    ctx.forward(timeline)


@cli.command()
@click.option("--check/--no-check",
              is_flag=True,
              help="Check if source URL is valid and readable. (Default: True)")
@click.option("--timeout",
              type=click.FLOAT,
              help="Maximum time requests are allowed to take. (Default: 5.0)")
@click.option("--porcelain",
              is_flag=True,
              help="Style output in an easy-to-parse format. (Default: False)")
@click.pass_context
def following(ctx, check, timeout, porcelain):
    """Return the list of sources you’re following."""
    sources = ctx.obj['conf'].following
    http_sources, base_sources = _split_sources_by_transport(sources)

    if check:
        statuses = get_remote_status(http_sources, timeout) if http_sources else []
        for (source, status) in statuses:
            click.echo(style_source_with_status(source, status, porcelain))
        for source in sorted(base_sources, key=lambda source: source.nick):
            click.echo(style_source(source, porcelain))
    else:
        sources = sorted(sources, key=lambda source: source.nick)
        for source in sources:
            click.echo(style_source(source, porcelain))


@cli.command()
@click.argument("nick")
@click.argument("url")
@click.option("--force", "-f",
              flag_value=True,
              help="Force adding and overwriting nick")
@click.pass_context
def follow(ctx, nick, url, force):
    """Add a new source to your followings."""
    if is_base_url(url) or is_base_address(url):
        try:
            url = to_base_url(url)
        except BaseConfigurationError as e:
            raise click.BadParameter(str(e), param_hint="url")

    source = Source(nick, url)
    sources = ctx.obj['conf'].following

    if not force:
        if source.nick in (source.nick for source in sources):
            click.confirm("➤ You’re already following {0}. Overwrite?".format(
                click.style(source.nick, bold=True)), default=False, abort=True)

        if not source.is_base:
            _, status = (get_remote_status([source]))[0]
            if not status or status.status_code != 200:
                click.confirm("➤ The feed of {0} at {1} is not available. Follow anyway?".format(
                    click.style(source.nick, bold=True),
                    click.style(source.url, bold=True)), default=False, abort=True)

    ctx.obj['conf'].add_source(source)
    click.echo("✓ You’re now following {0}.".format(
        click.style(source.nick, bold=True)))


@cli.command()
@click.argument("nick")
@click.pass_context
def unfollow(ctx, nick):
    """Remove an existing source from your followings."""
    source = ctx.obj['conf'].get_source_by_nick(nick)

    try:
        with Cache.discover(update_interval=ctx.obj["conf"].timeline_update_interval) as cache:
            cache.remove_tweets(source.url)
    except OSError as e:
        logger.debug(e)

    ret_val = ctx.obj['conf'].remove_source_by_nick(nick)
    if ret_val:
        click.echo("✓ You’ve unfollowed {0}.".format(
            click.style(source.nick, bold=True)))
    else:
        click.echo("✗ You’re not following {0}.".format(
            click.style(nick, bold=True)))


@cli.command("base-tweet")
@click.option("--network",
              type=click.Choice(sorted(NETWORKS.keys())),
              help="Base network to use. (Default: base-sepolia)")
@click.option("--rpc-url",
              envvar="TWTXT_BASE_RPC_URL",
              help="Base JSON-RPC endpoint. Overrides [base] rpc_url.")
@click.option("--contract",
              envvar="TWTXT_BASE_CONTRACT",
              help="BaseTwtxt contract address. Overrides [base] contract.")
@click.option("--private-key-env",
              default=PRIVATE_KEY_ENV,
              show_default=True,
              help="Environment variable containing the signing private key.")
@click.option("--timeout",
              type=click.INT,
              help="Seconds to wait for the transaction receipt. (Default: 120)")
@click.option("--yes",
              is_flag=True,
              help="Skip the Base Mainnet confirmation prompt.")
@click.argument("text", callback=validate_text, nargs=-1)
@click.pass_context
def base_tweet(ctx, network, rpc_url, contract, private_key_env, timeout, yes, text):
    """Publish a tweet as a Base-chain event."""
    conf = ctx.obj["conf"]
    options = _base_options(conf, network, rpc_url, contract)
    _confirm_mainnet(options["network"], yes)

    try:
        result = publish_tweet(
            text,
            options["contract_address"],
            network=options["network"],
            rpc_url=options["rpc_url"],
            private_key_env=private_key_env,
            timeout=timeout or 120,
        )
    except BaseChainError as e:
        _render_base_error(e)
        sys.exit(1)

    click.echo("✓ Posted to {0}: {1}".format(NETWORKS[options["network"]].display_name, result["tx_hash"]))


@cli.command("base-profile")
@click.option("--network",
              type=click.Choice(sorted(NETWORKS.keys())),
              help="Base network to use. (Default: base-sepolia)")
@click.option("--rpc-url",
              envvar="TWTXT_BASE_RPC_URL",
              help="Base JSON-RPC endpoint. Overrides [base] rpc_url.")
@click.option("--contract",
              envvar="TWTXT_BASE_CONTRACT",
              help="BaseTwtxt contract address. Overrides [base] contract.")
@click.option("--private-key-env",
              default=PRIVATE_KEY_ENV,
              show_default=True,
              help="Environment variable containing the signing private key.")
@click.option("--timeout",
              type=click.INT,
              help="Seconds to wait for RPC calls or transaction receipts. (Default: 120)")
@click.option("--yes",
              is_flag=True,
              help="Skip the Base Mainnet confirmation prompt.")
@click.option("--nick",
              help="Nick to publish for the signing account. Defaults to [twtxt] nick.")
@click.option("--twturl",
              help="twtxt URL to publish for the signing account. Defaults to [twtxt] twturl.")
@click.argument("account", required=False)
@click.pass_context
def base_profile(ctx, network, rpc_url, contract, private_key_env, timeout, yes, nick, twturl, account):
    """Publish or inspect a Base-chain profile."""
    conf = ctx.obj["conf"]
    options = _base_options(conf, network, rpc_url, contract)

    try:
        if nick is not None or twturl is not None:
            if account:
                raise click.BadArgumentUsage("Do not pass an account when publishing your own profile.")
            _confirm_mainnet(options["network"], yes)
            nick = nick or conf.nick
            if twturl is None and not conf.twturl:
                raise click.BadParameter(
                    "Base profile twturl is required when [twtxt] twturl is unset.",
                    param_hint="--twturl",
                )
            twturl = twturl if twturl is not None else conf.twturl
            result = set_profile(
                nick,
                twturl,
                options["contract_address"],
                network=options["network"],
                rpc_url=options["rpc_url"],
                private_key_env=private_key_env,
                timeout=timeout or 120,
            )
            click.echo("✓ Published Base profile: {0}".format(result["tx_hash"]))
            return

        if not account:
            raise click.BadArgumentUsage("Specify an account to inspect, or use --nick/--twturl to publish.")

        profile = get_profile(
            account,
            options["contract_address"],
            network=options["network"],
            rpc_url=options["rpc_url"],
            timeout=timeout or conf.timeout,
        )
    except BaseChainError as e:
        _render_base_error(e)
        sys.exit(1)

    if profile["updated_at"] == 0:
        click.echo("✗ No Base profile for {0}.".format(normalize_address(account)))
        return
    click.echo("{0}\t{1}\t{2}".format(profile["nick"], profile["twturl"], profile["updated_at"]))


@cli.command("base-timeline")
@click.option("--pager/--no-pager",
              is_flag=True,
              help="Use a pager to display content. (Default: False)")
@click.option("--limit", "-l",
              type=click.INT,
              help="Limit total number of shown tweets. (Default: 20)")
@click.option("--ascending", "sorting",
              flag_value="ascending",
              help="Sort timeline in ascending order.")
@click.option("--descending", "sorting",
              flag_value="descending",
              help="Sort timeline in descending order. (Default)")
@click.option("--timeout",
              type=click.FLOAT,
              help="Maximum time requests are allowed to take. (Default: 5.0)")
@click.option("--porcelain",
              is_flag=True,
              help="Style output in an easy-to-parse format. (Default: False)")
@click.option("--network",
              type=click.Choice(sorted(NETWORKS.keys())),
              help="Base network to use. (Default: base-sepolia)")
@click.option("--rpc-url",
              envvar="TWTXT_BASE_RPC_URL",
              help="Base JSON-RPC endpoint. Overrides [base] rpc_url.")
@click.option("--contract",
              envvar="TWTXT_BASE_CONTRACT",
              help="BaseTwtxt contract address. Overrides [base] contract.")
@click.option("--from-block",
              type=click.INT,
              help="First block to scan. Defaults to [base] from_block.")
@click.argument("sources", nargs=-1)
@click.pass_context
def base_timeline(ctx, pager, limit, sorting, timeout, porcelain, network, rpc_url,
                  contract, from_block, sources):
    """Retrieve a timeline from Base-chain twtxt events."""
    conf = ctx.obj["conf"]
    options = _base_options(conf, network, rpc_url, contract)

    try:
        base_sources = _base_sources_from_args(conf, sources)
        if not base_sources:
            return
        tweets = get_base_tweets(
            base_sources,
            options["contract_address"],
            network=options["network"],
            rpc_url=options["rpc_url"],
            from_block=_base_from_block(conf, from_block),
            timeout=timeout,
            limit=limit,
        )
    except BaseChainError as e:
        _render_base_error(e)
        sys.exit(1)

    if not tweets:
        return

    tweets = sort_and_truncate_tweets(tweets, sorting, limit)
    if pager:
        click.echo_via_pager(style_timeline(tweets, porcelain))
    else:
        click.echo(style_timeline(tweets, porcelain))


@cli.command()
def quickstart():
    """Quickstart wizard for setting up twtxt."""
    width = shutil.get_terminal_size()[0]
    width = width if width <= 79 else 79

    click.secho("twtxt - quickstart", fg="cyan")
    click.secho("==================", fg="cyan")
    click.echo()

    help_text = "This wizard will generate a basic configuration file for twtxt with all mandatory options set. " \
                "You can change all of these later with either twtxt itself or by editing the config file manually. " \
                "Have a look at the docs to get information about the other available options and their meaning."
    click.echo(textwrap.fill(help_text, width))

    click.echo()
    nick = click.prompt("➤ Please enter your desired nick", default=os.environ.get("USER", ""))

    def overwrite_check(path):
        if os.path.isfile(path):
            click.confirm("➤ '{0}' already exists. Overwrite?".format(path), abort=True)

    cfgfile = click.prompt("➤ Please enter the desired location for your config file",
                           os.path.join(Config.config_dir, Config.config_name),
                           type=click.Path(readable=True, writable=True, file_okay=True))
    cfgfile = os.path.expanduser(cfgfile)
    overwrite_check(cfgfile)

    twtfile = click.prompt("➤ Please enter the desired location for your twtxt file",
                           os.path.expanduser("~/twtxt.txt"),
                           type=click.Path(readable=True, writable=True, file_okay=True))
    twtfile = os.path.expanduser(twtfile)
    overwrite_check(twtfile)

    twturl = click.prompt("➤ Please enter the URL your twtxt file will be accessible from",
                          default="https://example.org/twtxt.txt")

    disclose_identity = click.confirm("➤ Do you want to disclose your identity? Your nick and URL will be shared when "
                                      "making HTTP requests", default=False)

    click.echo()
    add_news = click.confirm("➤ Do you want to follow the twtxt news feed?", default=True)

    conf = Config.create_config(cfgfile, nick, twtfile, twturl, disclose_identity, add_news)

    twtfile_dir = os.path.dirname(twtfile)
    if not os.path.exists(twtfile_dir):
        os.makedirs(twtfile_dir)
    open(twtfile, "a").close()

    click.echo()
    click.echo("✓ Created config file at '{0}'.".format(click.format_filename(conf.config_file)))
    click.echo("✓ Created twtxt file at '{0}'.".format(click.format_filename(twtfile)))


@cli.command()
@click.argument("key", required=False, callback=validate_config_key)
@click.argument("value", required=False)
@click.option("--remove",
              flag_value=True,
              help="Remove given item")
@click.option("--edit", "-e",
              flag_value=True,
              help="Open config file in editor")
@click.pass_context
def config(ctx, key, value, remove, edit):
    """Get or set config item."""
    conf = ctx.obj["conf"]

    if not edit and not key:
        raise click.BadArgumentUsage("You have to specify either a key or use --edit.")

    if edit:
        return click.edit(filename=conf.config_file)

    if remove:
        try:
            conf.cfg.remove_option(key[0], key[1])
        except Exception as e:
            logger.debug(e)
        else:
            conf.write_config()
        return

    if not value:
        try:
            click.echo(conf.cfg.get(key[0], key[1]))
        except Exception as e:
            logger.debug(e)
        return

    if not conf.cfg.has_section(key[0]):
        conf.cfg.add_section(key[0])

    conf.cfg.set(key[0], key[1], value)
    conf.write_config()


main = cli
