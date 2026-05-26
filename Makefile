# always rebuild docs
# -> needed because of directory named docs/
.PHONY: docs

all: test docs

test:
	@echo "---> running Python tests"
	@uv run pytest
	@echo "---> running contract tests"
	@forge test
	@echo "---> building frontend"
	@npm run build

pytest:
	@echo "---> running tests directly"
	@uv run pytest --tb=short -v --cov twtxt/ tests/

coverage:
	@echo "---> building coverage report"
	@uv run coverage html

docs:
	@echo "---> generating sphinx documentation"
	@$(MAKE) -C docs html

publish:
	@echo "---> uploading to PyPI"
	@uv build
	@uv publish

authors:
	@git log --format="%aN <%aE>" | sort -f | uniq
