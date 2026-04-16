# Raspberry Pi Setup

This guide covers installing Roaster Server on a Raspberry Pi, enabling automatic startup at boot, and using the built-in Wi-Fi provisioning flow when the Pi is not yet connected to your home network.

## What You Get

- Flask app starts automatically at boot through `systemd`
- Pi tries saved Wi-Fi first on startup
- If no Wi-Fi connects, Pi starts a temporary setup hotspot
- You connect with your phone and save home Wi-Fi credentials
- NetworkManager remembers those credentials for future boots

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
WIFI_INTERFACE=wlan0
WIFI_SETUP_SSID=Roaster-Setup
WIFI_SETUP_PASSWORD=changeme123
WIFI_SETUP_CONNECTION_NAME=roaster-setup
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

Once `roaster-server.service` is enabled, `systemd` starts it on every boot.

- The service runs `scripts/wifi_provisioning_bootstrap.sh`
- The script waits briefly for a saved Wi-Fi profile to connect
- If home Wi-Fi connects, the app starts normally
- If no saved Wi-Fi connects, the script starts the setup hotspot and enables Wi-Fi setup mode

From your phone:

1. Connect to the hotspot SSID from `WIFI_SETUP_SSID`
2. Open `http://10.42.0.1:5000/setup/wifi`
3. Choose your home Wi-Fi and enter the password
4. The Pi saves that network with NetworkManager for future boots

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
