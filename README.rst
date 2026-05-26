Sigline
~~~~~~~
|license|

**Sigline** is a small public feed signed on Base.

Sigline started as a fork of ``buckket/twtxt`` and keeps the flat-file client
available, but the primary path is now wallet-signed posting to an append-only
Base smart contract event log. The contract stores post events and small profile
records only; your wallet signs each write.


**tl;dr**: Sigline is a Base-native microfeed with a CLI, smart contract, and
wallet-based web frontend.

Features
--------

- A beautiful command-line interface thanks to click.
- Asynchronous HTTP requests thanks to asyncio/aiohttp and Python 3.
- Integrates well with existing tools (scp, cut, echo, date, etc.) and your shell.
- Base-chain publishing and timeline reads via an append-only smart contract event log.
- Wallet-based Vite/React frontend for posting, profile publishing, and feed reads.
- Optional image attachments via local IPFS or a trusted IPFS/Arweave upload endpoint.
- Legacy twtxt flat-file workflows are still available through the Python CLI.
- Don’t like the official client? Tweet using ``echo -e "`date +%FT%T%:z`\tHello world!" >> twtxt.txt``!

Documentation
-------------

Start with ``docs/user/base_chain.rst`` for the Base workflow.

Frontend
--------

Sigline includes a Vite/React frontend for wallet-based posting, profile
publishing, and event timeline reads:

.. code-block:: console

    $ npm install
    $ npm run dev

Quality checks
--------------

Run the full local verification stack before pushing:

.. code-block:: console

    $ npm run check

That command keeps Python on uv-managed tooling (``uv run ruff check .`` and
``uv run pytest``), checks the frontend with ESLint, TypeScript, and Vite, then
checks and tests the Solidity contracts with Foundry.

Community
---------

- twtxt IRC channel: **#twtxt** on `irc.libera.chat`_

Contributions
-------------

- A curated list of active twtxt users by `yarn.social <https://yarn.social/>`_: https://git.mills.io/yarnsocial/we-are-twtxt
- A web-based directory of twtxt users by `reednj <https://twitter.com/reednj>`_: http://twtxt.reednj.com/
- A web-based twtxt feed hoster for the masses by `plomlompom <http://www.plomlompom.de/>`_: https://github.com/plomlompom/htwtxt
- A twtxt-to-atom converter in sh by `erlehmann <http://news.dieweltistgarnichtso.net/>`_: http://news.dieweltistgarnichtso.net/bin/twtxt2atom
- A twitter-to-twtxt converter in node.js by `DracoBlue <https://github.com/DracoBlue>`_: https://gist.github.com/DracoBlue/488466eaabbb674c636f
- A port to node.js / npm by `Melvin Carvalho <https://github.com/melvincarvalho>`_: https://github.com/webize/twtxt
- A patched version of TweetNest, which serves TweetNest archives in twtxt format, by `texttheater <https://github.com/texttheater>`_: https://github.com/texttheater/tweetnest/tree/feat/twtxt
- A twtxt registry api by `DracoBlue <https://github.com/DracoBlue>`_: https://registry.twtxt.org
- A twtxt client written in perl by `mdom <https://github.com/mdom>`_: https://github.com/mdom/txtnix
- A twtxt client with minimal dependencies by `mdom <https://github.com/mdom>`_: https://github.com/mdom/txtnish
- A twtxt client written in C by `dertuxmalwieder <https://github.com/dertuxmalwieder>`_: https://hub.darcs.net/dertuxmalwieder/twtxtc
- A read-only timeline of the last 3000 tweets via gopher by `trqx <gopher://shroom.party>`_: gopher://shroom.party/1/twtxt
- A bot for using twtxt over xmpp by `mdosch <https://blog.mdosch.de>`_: https://salsa.debian.org/mdosch-guest/goxtxt
- twtxt registry server written in Go by `gbmor <https://github.com/gbmor>`_: https://github.com/gbmor/getwtxt-ng
- A twtxt parsing library written in Rust by `gbmor <https://github.com/gbmor>`_: https://github.com/rustwtxt/rustwtxt
- A twtxt WordPress plugin, that provides the blog-posts as twtxt file, written by `pfefferle <https://github.com/pfefferle>`_: https://github.com/pfefferle/wordpress-twtxt
- A twtxt client for Emacs by `deadblackclover <https://codeberg.org/deadblackclover/twtxt-el>`_: https://codeberg.org/deadblackclover/twtxt-el
- An php interface for publishing to your selfhosted twtxt.txt by `sorenpeter <https://github.com/sorenpeter>`_: https://github.com/sorenpeter/phpub2twtxt/
- A graphical twtxt client written in Tcl/Tk, RSS-to-twtxt converter, and mentions extractor by `dbohdan <https://dbohdan.com>`_: https://gitlab.com/dbohdan/twtxt.tcl
- twtwt: a really fast UNIX only twtxt client written in C by `win0err <https://github.com/win0err>`_: https://github.com/win0err/twtwt



License
-------

Sigline is released under the MIT License. See the bundled LICENSE file for details.


.. |license| image:: https://img.shields.io/badge/license-MIT-blue.svg?style=flat
    :target: https://raw.githubusercontent.com/0xnuminous/sigline/master/LICENSE
    :alt: Package license

.. _irc.libera.chat: https://libera.chat/
