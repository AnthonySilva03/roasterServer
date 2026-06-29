#!/usr/bin/env bash
#
# Install the Raspberry Pi direct access-point stack (hostapd + dnsmasq).
#
# Why not NetworkManager's built-in hotspot? On the Pi's brcmfmac Wi-Fi, NM's
# wpa_supplicant AP mode beacons but the driver rejects the cipher/PMF setup
# ("nl80211: key setting validation failed") and clients cannot associate.
# hostapd drives the same chip correctly, so the AP runs on hostapd while NM is
# told to leave wlan0 alone (eth0 stays managed for wired admin access).
#
# Run as root:  sudo ./scripts/install_pi_ap.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AP="$(cd "$SCRIPT_DIR/.." && pwd)/deploy/ap"

if [ "$(id -u)" -ne 0 ]; then
    echo "Run as root: sudo $0" >&2
    exit 1
fi

apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y hostapd dnsmasq

install -m 644 "$AP/99-roaster-unmanaged.conf" /etc/NetworkManager/conf.d/99-roaster-unmanaged.conf
install -m 600 "$AP/hostapd.conf"               /etc/hostapd/hostapd.conf
echo 'DAEMON_CONF="/etc/hostapd/hostapd.conf"' > /etc/default/hostapd
install -m 644 "$AP/roaster-dnsmasq.conf"       /etc/dnsmasq.d/roaster.conf

mkdir -p /etc/systemd/system/hostapd.service.d /etc/systemd/system/dnsmasq.service.d
install -m 644 "$AP/hostapd-ip.dropin.conf"          /etc/systemd/system/hostapd.service.d/10-roaster.conf
install -m 644 "$AP/dnsmasq-after-hostapd.dropin.conf" /etc/systemd/system/dnsmasq.service.d/10-roaster.conf

systemctl unmask hostapd
systemctl daemon-reload
systemctl enable hostapd dnsmasq
nmcli device set wlan0 managed no || true

echo "Direct-AP stack installed. Edit SSID/passphrase in /etc/hostapd/hostapd.conf"
echo "(match deploy/roaster-server.env), then reboot or: systemctl restart hostapd dnsmasq"
