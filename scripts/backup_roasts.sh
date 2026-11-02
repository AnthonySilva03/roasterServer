#!/usr/bin/env bash
# Save every roast from a running Roaster Server as one JSON backup document.
#
#   ./scripts/backup_roasts.sh http://192.168.1.191            # photos embedded
#   ./scripts/backup_roasts.sh http://192.168.1.191 --no-photos
#   OUT_DIR=/path/to/dir ./scripts/backup_roasts.sh http://<pi-address>
#
# Restore with: curl -X POST -H 'Content-Type: application/json' \
#                    --data-binary @backups/<file>.json http://<pi-address>/api/roasts/import
set -euo pipefail

BASE_URL="${1:-}"
if [ -z "$BASE_URL" ]; then
    echo "usage: $0 <base-url> [--no-photos]" >&2
    exit 1
fi
BASE_URL="${BASE_URL%/}"

QUERY=""
if [ "${2:-}" = "--no-photos" ]; then
    QUERY="?photos=0"
fi

OUT_DIR="${OUT_DIR:-$(cd "$(dirname "$0")/.." && pwd)/backups}"
mkdir -p "$OUT_DIR"
OUT_FILE="$OUT_DIR/roaster-backup-$(date +%Y-%m-%d-%H%M%S).json"

curl -fsS --max-time 300 "$BASE_URL/api/roasts/export$QUERY" -o "$OUT_FILE"

COUNT=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["count"])' "$OUT_FILE" 2>/dev/null || echo "?")
SIZE=$(du -h "$OUT_FILE" | cut -f1)
echo "Saved $COUNT roast(s) ($SIZE) to $OUT_FILE"
