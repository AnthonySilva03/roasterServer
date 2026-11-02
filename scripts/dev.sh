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
  seed-roasts   Replace saved roasts with demo test roasts
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

# Anything that builds the app needs a real SECRET_KEY (placeholders are refused);
# give local commands a throwaway one when none is exported. On macOS eventlet's
# kqueue hub crashes under Python 3.9, so default to the select hub there.
app_env() {
    export SECRET_KEY="${SECRET_KEY:-$("$PYTHON" -c 'import secrets; print(secrets.token_hex(32))')}"
    if [[ "$(uname -s)" == "Darwin" ]]; then export EVENTLET_HUB="${EVENTLET_HUB:-selects}"; fi
}

case "$1" in
    install)
        "$PIP" install -r requirements.txt
        ;;
    install-dev)
        "$PIP" install -r requirements-dev.txt
        ;;
    run)
        app_env
        "$PYTHON" run.py
        ;;
    seed-roasts)
        app_env
        PYTHONPATH=. "$PYTHON" scripts/seed_test_roasts.py
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
