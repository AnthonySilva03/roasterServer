PYTHON := ./venv/bin/python
PIP := ./venv/bin/pip

.PHONY: help install install-dev run test test-fast compile check clean

help:
	@printf "Available targets:\n"
	@printf "  make install      Install app dependencies\n"
	@printf "  make install-dev  Install app and test dependencies\n"
	@printf "  make run          Start the Flask-SocketIO app\n"
	@printf "  make test         Run the full pytest suite\n"
	@printf "  make test-fast    Run pytest in quiet mode\n"
	@printf "  make compile      Compile-check Python files\n"
	@printf "  make check        Run compile checks and tests\n"
	@printf "  make clean        Remove local cache artifacts\n"

install:
	$(PIP) install -r requirements.txt

install-dev:
	$(PIP) install -r requirements-dev.txt

run:
	$(PYTHON) run.py

test:
	$(PYTHON) -m pytest

test-fast:
	$(PYTHON) -m pytest -q

compile:
	$(PYTHON) -m compileall app tests run.py config.py

check: compile test-fast

clean:
	find . -type d -name "__pycache__" -prune -exec rm -rf {} +
	find . -type d -name ".pytest_cache" -prune -exec rm -rf {} +
