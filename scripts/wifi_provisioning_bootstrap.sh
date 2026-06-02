#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-$PROJECT_ROOT/venv/bin/python}"
APP_ENTRYPOINT="${APP_ENTRYPOINT:-$PROJECT_ROOT/run.py}"

# Network operating mode:
#   direct-ap  Pi is its own Wi-Fi hub. The phone connects directly to the Pi's
#              network and runs the FULL roaster app. No shared router needed. (default)
#   provision  Try saved Wi-Fi first; if none connects, start a temporary setup
#              hotspot that only serves the /setup/wifi onboarding page.
#   client     Only use saved Wi-Fi as a normal client; never start a hotspot.
ROASTER_NET_MODE="${ROASTER_NET_MODE:-direct-ap}"

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

log() {
    echo "[roaster-bootstrap] $*"
}

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

# Create or update the access-point NetworkManager profile (idempotent).
# $1 = autoconnect flag ("yes" for a permanent direct-AP, "no" for a temporary setup hotspot).
configure_ap_profile() {
    local autoconnect_flag="$1"
    local priority=0
    if [ "$autoconnect_flag" = "yes" ]; then
        priority=10
    fi

    if ! nmcli connection show "$WIFI_SETUP_CONNECTION_NAME" >/dev/null 2>&1; then
        nmcli connection add \
            type wifi \
            ifname "$WIFI_INTERFACE" \
            con-name "$WIFI_SETUP_CONNECTION_NAME" \
            ssid "$WIFI_SETUP_SSID"
    fi

    nmcli connection modify "$WIFI_SETUP_CONNECTION_NAME" \
        802-11-wireless.ssid "$WIFI_SETUP_SSID" \
        802-11-wireless.mode ap \
        802-11-wireless.band bg \
        ipv4.method shared \
        ipv6.method ignore \
        wifi-sec.key-mgmt wpa-psk \
        wifi-sec.psk "$WIFI_SETUP_PASSWORD" \
        connection.autoconnect "$autoconnect_flag" \
        connection.autoconnect-priority "$priority"
}

bring_up_ap() {
    # Bringing the AP up takes wlan0 off any client network (single radio).
    nmcli connection up "$WIFI_SETUP_CONNECTION_NAME" ifname "$WIFI_INTERFACE"
}

start_direct_ap() {
    log "Starting direct access-point mode (SSID: $WIFI_SETUP_SSID, gateway 10.42.0.1)"
    configure_ap_profile yes
    bring_up_ap
    export WIFI_SETUP_MODE=false
}

start_setup_hotspot() {
    log "No saved Wi-Fi connected; starting setup hotspot (SSID: $WIFI_SETUP_SSID)"
    configure_ap_profile no
    bring_up_ap
    export WIFI_SETUP_MODE=true
}

start_normal_mode() {
    log "Using saved Wi-Fi client connection"
    export WIFI_SETUP_MODE=false
}

case "$ROASTER_NET_MODE" in
    direct-ap)
        start_direct_ap
        ;;
    provision)
        if wait_for_saved_wifi; then
            start_normal_mode
        else
            start_setup_hotspot
        fi
        ;;
    client)
        start_normal_mode
        ;;
    *)
        log "Unknown ROASTER_NET_MODE='$ROASTER_NET_MODE'; defaulting to direct-ap"
        start_direct_ap
        ;;
esac

log "Launching roaster app (mode=$ROASTER_NET_MODE, WIFI_SETUP_MODE=${WIFI_SETUP_MODE:-false})"
exec "$PYTHON_BIN" "$APP_ENTRYPOINT"
