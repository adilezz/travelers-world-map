# Travelers World Map v2 (document 6). Run from database/.
PY ?= python3
BUNDLE ?=
PREVIOUS ?=

.PHONY: test verify release-verify lint help

help:
	@echo "make test            unit tests for the gates, the golden file and the schema (must pass)"
	@echo "make verify BUNDLE=  run every gate against a published bundle (fails until the pipeline passes)"
	@echo "make release-verify  also run the holdout and precision gates"

test:
	$(PY) -m pytest -c tests_v2/pytest.ini tests_v2 twm2

verify:
	$(PY) -m twm2.verify $(if $(BUNDLE),--bundle $(BUNDLE)) $(if $(PREVIOUS),--previous $(PREVIOUS))

release-verify:
	$(PY) -m twm2.verify --release $(if $(BUNDLE),--bundle $(BUNDLE)) $(if $(PREVIOUS),--previous $(PREVIOUS))

lint:
	$(PY) -m ruff check twm2 tests_v2
