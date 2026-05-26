# Contributing

Thank you for helping twtxt to get a better piece of software.

## Support

If you have any questions regarding the usage of twtxt please visit us in the #twtxt IRC channel on [freenode.net](https://freenode.net/)
or post your question on [StackOverflow](https://stackoverflow.com).

## Reporting Issues / Proposing Features

Before you submit an Issue or proposing a Feature check the existing Issues in order to avoid duplicates. <br>
Please make sure you provide enough information to work on your submitted Issue or proposed Feature:

* Which version of twtxt are you using?
* Which version of Python are you using?
* On which platform are you running twtxt?

## Pull Requests

We are very happy to receive Pull Requests! Please consider:

* Style Guide. Follow the rules of [PEP8](http://legacy.python.org/dev/peps/pep-0008/), but you may ignore *too-long-lines* and similar warnings.
* Tests. If our change affects Python code inside the source code directory, please make sure your code is covered by an automated test case.
* Documentation. If your change updates any interfaces, adds new features or change behavior please make sure the documentation is updated accordingly.

### Testing

Install the Python development dependencies with uv:

```bash
uv sync --dev
```

To test the full source tree:

```bash
cd ~/work/twtxt
make test
```

To run only the Python tests:

```bash
cd ~/work/twtxt
uv run pytest
```

The Base-chain contract and frontend checks are:

```bash
forge test
npm run build
```

### Documentation

The documentation can be generated using the `docs` rule in `make`:

```bash
make docs
```

The build directory of the documentation is located in *docs/_build/html*.
To open this documentation just open the *index.html* with your preferred browser:

```
open docs/_build/html/index.html
```
