import subprocess


class WifiCommandError(RuntimeError):
    """Raised when a NetworkManager command fails."""


def is_setup_mode_enabled(app):
    return bool(app.config.get("WIFI_SETUP_MODE", False))


def list_networks(app):
    command = [
        "-t",
        "-f",
        "SSID,SIGNAL,SECURITY",
        "device",
        "wifi",
        "list",
        "ifname",
        app.config["WIFI_INTERFACE"],
        "--rescan",
        "yes",
    ]
    result = _run_nmcli(app, command)

    networks = []
    seen_ssids = set()

    for raw_line in result.stdout.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        columns = _split_escaped_fields(line, expected_fields=3)
        if len(columns) < 3:
            continue

        ssid = columns[0]
        if ssid == "--" or ssid in seen_ssids:
            continue

        signal = columns[1] if columns[1].isdigit() else None
        security = columns[2]

        seen_ssids.add(ssid)
        networks.append(
            {
                "ssid": ssid,
                "signal": int(signal) if signal else None,
                "security": security,
            }
        )

    return sorted(
        networks,
        key=lambda network: (
            network["signal"] is None,
            -(network["signal"] or 0),
            network["ssid"].lower(),
        ),
    )


def connect_to_network(app, ssid, password="", hidden=False):
    command = [
        "dev",
        "wifi",
        "connect",
        ssid,
        "ifname",
        app.config["WIFI_INTERFACE"],
    ]

    if password:
        command.extend(["password", password])

    if hidden:
        command.extend(["hidden", "yes"])

    _run_nmcli(app, command)

    # Favor saved home Wi-Fi profiles over the temporary setup hotspot.
    _run_nmcli(
        app,
        [
            "connection",
            "modify",
            ssid,
            "connection.autoconnect",
            "yes",
            "connection.autoconnect-priority",
            "10",
        ],
    )

    deactivate_hotspot(app)


def deactivate_hotspot(app):
    hotspot_name = app.config.get("WIFI_SETUP_CONNECTION_NAME", "")
    if not hotspot_name:
        return

    try:
        _run_nmcli(app, ["connection", "down", hotspot_name], check=False)
    except WifiCommandError:
        return


def _run_nmcli(app, arguments, check=True):
    command = []
    if app.config.get("WIFI_USE_SUDO_FOR_NMCLI", False):
        command.extend(["sudo", "-n"])

    command.append(app.config["WIFI_NMCLI_BINARY"])
    command.extend(arguments)

    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError as exc:
        raise WifiCommandError(f"Failed to run Wi-Fi command: {exc}") from exc

    if check and result.returncode != 0:
        error_text = (result.stderr or result.stdout or "Wi-Fi command failed").strip()
        raise WifiCommandError(error_text)

    return result


def _split_escaped_fields(line, expected_fields):
    fields = []
    current = []
    escaped = False

    for character in line:
        if escaped:
            current.append(character)
            escaped = False
            continue

        if character == "\\":
            escaped = True
            continue

        if character == ":" and len(fields) < expected_fields - 1:
            fields.append("".join(current).strip())
            current = []
            continue

        current.append(character)

    fields.append("".join(current).strip())
    return fields
