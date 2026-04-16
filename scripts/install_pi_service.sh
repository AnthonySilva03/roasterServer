#!/usr/bin/env bash

set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-roaster-server.service}"
INSTALL_ROOT="${INSTALL_ROOT:-/home/pi/roasterServer}"
SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"
SERVICE_PATH="$SYSTEMD_DIR/$SERVICE_NAME"
ENV_TEMPLATE="$INSTALL_ROOT/deploy/roaster-server.env.example"
ENV_PATH="$INSTALL_ROOT/deploy/roaster-server.env"
UNIT_TEMPLATE="$INSTALL_ROOT/deploy/roaster-server.service"

if [ ! -f "$UNIT_TEMPLATE" ]; then
    echo "Missing service template: $UNIT_TEMPLATE" >&2
    exit 1
fi

if [ ! -f "$ENV_PATH" ]; then
    cp "$ENV_TEMPLATE" "$ENV_PATH"
    echo "Created $ENV_PATH from template. Edit it before starting the service."
fi

install -m 644 "$UNIT_TEMPLATE" "$SERVICE_PATH"
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

echo "Installed $SERVICE_NAME to $SERVICE_PATH"
echo "Next steps:"
echo "  1. Edit $ENV_PATH"
echo "  2. Verify the paths and User= lines in $SERVICE_PATH"
echo "  3. Start with: sudo systemctl start $SERVICE_NAME"
