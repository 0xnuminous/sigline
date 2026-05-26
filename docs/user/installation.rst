.. _installation:

Installation
============

twtxt is a Python application. This repository uses uv_ for Python dependency
management, virtual environments, command execution, builds, and publishing.

**Requirements**:

- Python_ >= **3.10**
- uv_

Release version
---------------

Install the released command-line application with uv:

.. code-block:: console

    $ uv tool install twtxt

Run it:

.. code-block:: console

    $ twtxt --help

Development version
-------------------

Clone the git_ repository:

.. code-block:: console

    $ git clone https://github.com/buckket/twtxt.git
    $ cd twtxt

Install the project and development dependencies:

.. code-block:: console

    $ uv sync --dev

Run the Python tests:

.. code-block:: console

    $ uv run pytest

The Base-chain contract and frontend use the Node.js and Foundry toolchains:

.. code-block:: console

    $ npm install
    $ forge test
    $ npm run build

.. _Python: https://www.python.org/
.. _uv: https://docs.astral.sh/uv/
.. _git: https://git-scm.com/
