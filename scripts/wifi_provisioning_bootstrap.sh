#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-$PROJECT_ROOT/venv/bin/python}"
APP_ENTRYPOINT="${APP_ENTRYPOINT:-$PROJECT_ROOT/run.py}"

WIFI_INTERFACE="${WIFI_INTERFACE:-wlan0}"
WIFI_SETUP_SSID="${WIFI_SETUP_SSID:-Roaster-Setup}"
WIFI_SETUP_PASSWORD="${WIFI_SETUP_PASSWORD:-changeme123}"
WIFI_SETUP_CONNECTION_NAME="${WIFI_SETUP_CONNECTION_NAME:-roaster-setup}"
WIFI_CONNECT_WAIT_SECONDS="${WIFI_CONNECT_WAIT_SECONDS:-20}"

cd "$PROJECT_ROOT"
mkdir -p "$PROJECT_ROOT/instance"

if [ ! -x "$PYTHON_BIN" ]; then
    PYTHON_BIN="python3"
fi

wait_for_saved_wifi() {
    local deadline=$((SECONDS + WIFI_CONNECT_WAIT_SECONDS))

    while [ "$SECONDS" -lt "$deadline" ]; do
        if nmcli -t -f GENERAL.STATE device show "$WIFI_INTERFACE" | grep -q ":100"; then
            return 0
        fi
        sleep 2
    done

    return 1
}

ensure_hotspot_profile() {
    if nmcli connection show "$WIFI_SETUP_CONNECTION_NAME" >/dev/null 2>&1; then
        nmcli connection modify "$WIFI_SETUP_CONNECTION_NAME" \
            802-11-wireless.ssid "$WIFI_SETUP_SSID" \
            802-11-wireless.mode ap \
            802-11-wireless.band bg \
            ipv4.method shared \
            ipv6.method ignore \
            wifi-sec.key-mgmt wpa-psk \
            wifi-sec.psk "$WIFI_SETUP_PASSWORD" \
            connection.autoconnect no
        return
    fi

    nmcli connection add \
        type wifi \
        ifname "$WIFI_INTERFACE" \
        con-name "$WIFI_SETUP_CONNECTION_NAME" \
        ssid "$WIFI_SETUP_SSID"

    nmcli connection modify "$WIFI_SETUP_CONNECTION_NAME" \
        802-11-wireless.mode ap \
        802-11-wireless.band bg \
        ipv4.method shared \
        ipv6.method ignore \
        wifi-sec.key-mgmt wpa-psk \
        wifi-sec.psk "$WIFI_SETUP_PASSWORD" \
        connection.autoconnect no
}

start_hotspot_and_setup_mode() {
    ensure_hotspot_profile
    nmcli connection up "$WIFI_SETUP_CONNECTION_NAME" ifname "$WIFI_INTERFACE"
    export WIFI_SETUP_MODE=true
}

start_normal_mode() {
    export WIFI_SETUP_MODE=false
}

if wait_for_saved_wifi; then
    start_normal_mode
else
    start_hotspot_and_setup_mode
fi

exec "$PYTHON_BIN" "$APP_ENTRYPOINT"
