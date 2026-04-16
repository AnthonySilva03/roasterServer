#!/usr/bin/env bash
set -euo pipefail

PYTHON="${PYTHON:-./venv/bin/python}"
PIP="${PIP:-./venv/bin/pip}"

usage() {
    cat <<'EOF'
Usage: ./scripts/dev.sh <command>

Commands:
  install       Install app dependencies
  install-dev   Install app and test dependencies
  run           Start the app
  test          Run the full pytest suite
  test-fast     Run pytest in quiet mode
  compile       Compile-check Python files
  check         Run compile checks and tests
EOF
}

if [[ $# -lt 1 ]]; then
    usage
    exit 1
fi

case "$1" in
    install)
        "$PIP" install -r requirements.txt
        ;;
    install-dev)
        "$PIP" install -r requirements-dev.txt
        ;;
    run)
        "$PYTHON" run.py
        ;;
    test)
        "$PYTHON" -m pytest
        ;;
    test-fast)
        "$PYTHON" -m pytest -q
        ;;
    compile)
        "$PYTHON" -m compileall app tests run.py config.py
        ;;
    check)
        "$PYTHON" -m compileall app tests run.py config.py
        "$PYTHON" -m pytest -q
        ;;
    *)
        usage
        exit 1
        ;;
esac
