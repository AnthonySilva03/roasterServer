# Raspberry Pi Setup

This guide covers installing Roaster Server on a Raspberry Pi, enabling automatic startup at boot, and choosing how the Pi handles Wi-Fi.

## Network Modes

The startup script supports three modes via the `ROASTER_NET_MODE` env var:

| Mode | Behavior | Phone connects to |
|---|---|---|
| `direct-ap` (default) | Pi runs its **own Wi-Fi hub** and serves the full app. No router needed. | The Pi's own SSID |
| `provision` | Try saved Wi-Fi; if none connects, start a setup hotspot that serves only `/setup/wifi`. | Home Wi-Fi (or setup hotspot to onboard) |
| `client` | Use saved Wi-Fi only; never start a hotspot. | Home Wi-Fi |

## What You Get

- Flask app starts automatically at boot through `systemd`
- In `direct-ap` mode the Pi broadcasts its own Wi-Fi network at boot; your phone joins it and runs the full roaster app directly — both devices do **not** need to be on the same external network
- In `provision`/`client` modes the Pi behaves as a normal Wi-Fi client with an onboarding fallback

## Files Used

- [deploy/roaster-server.service](/home/ub20/Documents/python/flaskTesting/roasterServer/deploy/roaster-server.service)
- [deploy/roaster-server.env.example](/home/ub20/Documents/python/flaskTesting/roasterServer/deploy/roaster-server.env.example)
- [scripts/install_pi_service.sh](/home/ub20/Documents/python/flaskTesting/roasterServer/scripts/install_pi_service.sh)
- [scripts/wifi_provisioning_bootstrap.sh](/home/ub20/Documents/python/flaskTesting/roasterServer/scripts/wifi_provisioning_bootstrap.sh)

## Fresh Pi Install

1. Install system packages:

```bash
sudo apt update
sudo apt install -y python3-venv python3-pip network-manager pigpio
sudo systemctl enable NetworkManager
sudo systemctl start NetworkManager
```

2. Put the project on the Pi and install Python dependencies:

```bash
cd /home/pi/roasterServer
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
```

3. Create the runtime env file:

```bash
cp deploy/roaster-server.env.example deploy/roaster-server.env
```

Suggested starting contents:

```env
SECRET_KEY=change-me
DATABASE_URL=sqlite:////home/pi/roasterServer/instance/roasts.db
SENSOR_MODE=simulated
START_SENSOR_BACKGROUND_TASK=true
LOG_LEVEL=INFO
ROASTER_NET_MODE=direct-ap
WIFI_INTERFACE=wlan0
WIFI_SETUP_SSID=Roaster
WIFI_SETUP_PASSWORD=roastme123
WIFI_SETUP_CONNECTION_NAME=roaster-ap
WIFI_CONNECT_WAIT_SECONDS=20
WIFI_USE_SUDO_FOR_NMCLI=true
```

4. Allow the app to run `nmcli` without a password prompt. Create `/etc/sudoers.d/roaster-server` with:

```sudoers
pi ALL=(root) NOPASSWD: /usr/bin/nmcli
```

Validate it:

```bash
sudo visudo -cf /etc/sudoers.d/roaster-server
```

5. Install and enable the startup service:

```bash
chmod +x scripts/wifi_provisioning_bootstrap.sh scripts/install_pi_service.sh
sudo ./scripts/install_pi_service.sh
sudo systemctl enable roaster-server.service
sudo systemctl start roaster-server.service
```

6. Verify the service:

```bash
sudo systemctl status roaster-server.service
sudo journalctl -u roaster-server.service -f
sudo systemctl is-enabled roaster-server.service
```

## Automatic Startup Behavior

Once `roaster-server.service` is enabled, `systemd` starts it on every boot. The
service runs `scripts/wifi_provisioning_bootstrap.sh`, which branches on
`ROASTER_NET_MODE`:

- `direct-ap` — brings up the Pi's own access point and launches the full app
- `provision` — waits briefly for saved Wi-Fi; starts the setup hotspot only if none connects
- `client` — starts the app against saved Wi-Fi, no hotspot

## Direct Access-Point Mode (recommended)

The Pi becomes its own Wi-Fi hub so a phone can connect and run the app with no
shared router. **On Raspberry Pi hardware this runs on `hostapd`, not
NetworkManager.**

> **Why hostapd, not NetworkManager?** NM's built-in (`nmcli`/wpa_supplicant) AP
> mode beacons on the Pi's `brcmfmac` chip but the driver rejects its cipher/PMF
> setup ("nl80211: key setting validation failed"), so **clients can't
> associate**. `hostapd` drives the same chip correctly. The `ROASTER_NET_MODE`
> nmcli path in `wifi_provisioning_bootstrap.sh` is therefore **deprecated for
> direct-ap on real Pi hardware** — use the hostapd stack below.

### Install the hostapd AP stack

```bash
cd /home/pi/roasterServer
sudo ./scripts/install_pi_ap.sh        # installs hostapd + dnsmasq + configs
sudo ./scripts/install_pi_service.sh   # installs/enables the app service
# edit SSID/passphrase in /etc/hostapd/hostapd.conf to match deploy/roaster-server.env
sudo reboot
```

How it works (all from `deploy/ap/`, installed by `install_pi_ap.sh`):

- **NetworkManager leaves `wlan0` unmanaged** (`99-roaster-unmanaged.conf`); `eth0` stays managed for wired admin access while the AP runs.
- **hostapd** runs the AP (WPA2/CCMP, channel 6, country US). A drop-in assigns `wlan0` the gateway IP `10.42.0.1/24` before it starts.
- **dnsmasq** serves DHCP (`10.42.0.10–100`) and a captive-portal DNS hijack (`address=/#/10.42.0.1`) so the app opens on join. It starts after hostapd.
- The **app service** just runs the app on `PORT=80` (`CAP_NET_BIND_SERVICE` lets it bind 80 as `pi`); the in-app captive routes (`CAPTIVE_PORTAL_ENABLED=true`) redirect probes to the dashboard.

From your phone:

1. In Wi-Fi settings, join the network named by `WIFI_SETUP_SSID` (e.g. `Roaster`), password `WIFI_SETUP_PASSWORD`
2. The roaster app should open automatically (captive portal). If it doesn't, open `http://10.42.0.1`
3. Use the dashboard, roast session, and lookup pages normally

### Install it as an app (PWA)

The web app is an installable, offline-capable PWA, so it behaves like a native
app on the roaster network (which has no internet):

- **Install:** in the browser menu choose "Add to Home Screen" / "Install app". It then launches full-screen with its own icon.
- **Offline:** third-party libraries are vendored locally and a service worker precaches the app shell, so the UI and saved roasts work without internet. Only the world map tiles need internet and degrade to a dark background.
- **During a roast:** the screen stays awake (Wake Lock) and you get notifications for the turn point, an RoR crash, or hardware issues. An in-progress roast is saved to the browser, so a tab close/crash can be resumed.

> **⚠️ Single-radio lockout warning.** A Raspberry Pi's built-in Wi-Fi has one
> radio. Switching `wlan0` into AP mode **disconnects the Pi from any home Wi-Fi
> on that interface** — including an SSH session you opened over it. Activate
> direct-ap mode from a keyboard/monitor, over Ethernet (`eth0`), or accept that
> you will reconnect via the Pi's own `Roaster` network afterward. The `10.42.0.1`
> address is only reachable once your phone/laptop has joined that network.

### Switching modes / recovery

To leave direct-ap mode (e.g. to put the Pi back on home Wi-Fi), edit
`deploy/roaster-server.env`, set `ROASTER_NET_MODE=provision` (or `client`), then:

```bash
sudo systemctl restart roaster-server.service
```

In `provision` mode, onboard home Wi-Fi from the phone:

1. Connect to the setup hotspot SSID
2. Open `http://10.42.0.1:5000/setup/wifi`
3. Choose your home Wi-Fi and enter the password — NetworkManager remembers it for future boots

## Useful Service Commands

```bash
sudo systemctl restart roaster-server.service
sudo systemctl stop roaster-server.service
sudo systemctl status roaster-server.service
sudo journalctl -u roaster-server.service -f
```

## Hardware Mode

If you are using the real Raspberry Pi hardware reader instead of simulated mode:

```bash
sudo systemctl enable pigpiod
sudo systemctl start pigpiod
```

Then set this in `deploy/roaster-server.env`:

```env
SENSOR_MODE=pigpio
```

Optional GPIO overrides:

```env
MAX6675_CS_PIN=8
MAX6675_CLK_PIN=11
MAX6675_DO_PIN=9
SERVO_CONTROL_PIN=18
```

## Troubleshooting

- If the setup page cannot save Wi-Fi, check the `sudoers` rule for `/usr/bin/nmcli`
- If the service fails on boot, run `sudo journalctl -u roaster-server.service -b`
- If your Pi username or install path is different, update `User=`, `Group=`, `WorkingDirectory=`, `EnvironmentFile=`, and `ExecStart=` in [deploy/roaster-server.service](/home/ub20/Documents/python/flaskTesting/roasterServer/deploy/roaster-server.service)
- If the Pi never enters hotspot mode, verify `NetworkManager` is enabled and that `wlan0` is the correct interface
