#!/usr/bin/env bash

set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-roaster-server.service}"
INSTALL_ROOT="${INSTALL_ROOT:-/home/pi/roasterServer}"
SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"
SERVICE_PATH="$SYSTEMD_DIR/$SERVICE_NAME"
ENV_TEMPLATE="$INSTALL_ROOT/deploy/roaster-server.env.example"
ENV_PATH="$INSTALL_ROOT/deploy/roaster-server.env"
UNIT_TEMPLATE="$INSTALL_ROOT/deploy/roaster-server.service"
DNSMASQ_TEMPLATE="$INSTALL_ROOT/deploy/dnsmasq-shared-roaster.conf"
DNSMASQ_DIR="/etc/NetworkManager/dnsmasq-shared.d"
DNSMASQ_PATH="$DNSMASQ_DIR/roaster-captive.conf"
SUDOERS_TEMPLATE="$INSTALL_ROOT/deploy/sudoers-roaster-server"
SUDOERS_PATH="/etc/sudoers.d/roaster-server"

if [ ! -f "$UNIT_TEMPLATE" ]; then
    echo "Missing service template: $UNIT_TEMPLATE" >&2
    exit 1
fi

if [ ! -f "$ENV_PATH" ]; then
    cp "$ENV_TEMPLATE" "$ENV_PATH"
    echo "Created $ENV_PATH from template. Edit it before starting the service."
fi

install -m 644 "$UNIT_TEMPLATE" "$SERVICE_PATH"

# Captive-portal DNS hijack for direct-ap mode (resolves all names to the Pi).
if [ -f "$DNSMASQ_TEMPLATE" ]; then
    mkdir -p "$DNSMASQ_DIR"
    install -m 644 "$DNSMASQ_TEMPLATE" "$DNSMASQ_PATH"
    echo "Installed captive-portal DNS config to $DNSMASQ_PATH"
fi

# Passwordless nmcli (Wi-Fi setup page) and service restart (deploys) for the
# service user. visudo must accept the file before it goes anywhere near sudoers.d.
if [ -f "$SUDOERS_TEMPLATE" ]; then
    if visudo -cf "$SUDOERS_TEMPLATE" >/dev/null; then
        install -m 440 -o root -g root "$SUDOERS_TEMPLATE" "$SUDOERS_PATH"
        echo "Installed sudoers rules to $SUDOERS_PATH"
    else
        echo "Refusing to install $SUDOERS_TEMPLATE: visudo rejected it" >&2
        exit 1
    fi
fi

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

echo "Installed $SERVICE_NAME to $SERVICE_PATH"
echo "Next steps:"
echo "  1. Edit $ENV_PATH"
echo "  2. Verify the paths and User= lines in $SERVICE_PATH"
echo "  3. Start with: sudo systemctl start $SERVICE_NAME"
