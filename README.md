# Mac Ethernet Share

Share a Mac's Wi-Fi connection with an Ethernet-connected device: a computer,
game console, development board, or another device that supports manual IPv4 settings.
A Swift daemon watches network and hardware events and starts sharing when the
selected Ethernet adapter and upstream connection are ready.

No third-party runtime, DHCP server, or device-specific software is required.
Sharing supports **one client IPv4 address at a time**.

## Why this project exists

This project began in a university dorm room. My PS5 could not connect directly
to the eduroam network, so I used my MacBook as a bridge between Wi-Fi and a USB
Ethernet adapter. I wanted the connection to become available automatically as
soon as I plugged in the adapter, without repeating a series of network and power
commands every time.

The original setup was built for that PS5, but the same problem applies to many
devices that cannot join an enterprise Wi-Fi network. The project is now generic:
it can share a Mac's Wi-Fi connection with any Ethernet client that supports the
documented static IPv4 configuration.

## Requirements

- macOS with Xcode Command Line Tools (`xcode-select --install`).
- An Ethernet adapter supported by macOS and a working Wi-Fi connection.
- Administrator access to install and control the service.
- A client that supports a static IPv4 address.

The implementation uses macOS PF, IOKit, SystemConfiguration, and `launchd`.
Hardware behavior, especially closed-lid operation, varies by Mac and macOS release.

## Configure and install

Clone the repository and inspect the hardware ports:

```bash
git clone https://github.com/kaanunsel/mac-ethernet-share.git
cd mac-ethernet-share
networksetup -listallhardwareports
cp Configuration.example.swift Configuration.local.swift
```

Edit `Configuration.local.swift`:

```swift
enum Configuration {
    static let ethernetMAC = "02:00:00:00:00:01" // Replace with your Ethernet adapter's MAC.
    static let upstreamInterface = "en0"       // Replace with your Wi-Fi interface.
}
```

Use the Ethernet adapter's hardware address on the **Mac**, not the client's address.
The daemon resolves the adapter's current interface name by MAC address, so an
interface number change does not require rebuilding. It does not require a specific
USB vendor, product, or serial number. The local configuration is ignored by Git.
The selected upstream must be the primary IPv4 interface; VPN routes that change
that interface stop sharing. This project is intended for Wi-Fi-to-Ethernet use.

Build, check, and install:

```bash
bash tests/check.sh
.build/ethernetshared check-config
sudo bash install.sh
./ethernet-share.sh status
./ethernet-share.sh start
```

A fresh installation starts paused for the current boot. `start` enables automatic
sharing immediately. A reboot clears this pause, so the daemon can start sharing
when the configured adapter is ready. The example configuration deliberately has
no adapter address: builds and tests work, but installation refuses it until configured.

Configure the Ethernet client manually:

| Setting | Value |
| --- | --- |
| IPv4 address | `192.168.2.2` |
| Subnet mask | `255.255.255.0` |
| Gateway | `192.168.2.1` |
| DNS servers | `1.1.1.1`, `8.8.8.8` (or your preferred reachable DNS servers) |

The subnet and client address are currently fixed. No DHCP or IPv6 routing is
provided. The Mac's downstream interface must have no non-link-local IPv4 address
before sharing starts. An existing route for `192.168.2.0/24` prevents startup;
use an upstream network that does not overlap this subnet. Broader overlapping
routes are not comprehensively detected.

## Everyday use

```bash
./ethernet-share.sh start   # Enable automatic sharing
./ethernet-share.sh stop    # Pause until start or the next reboot
./ethernet-share.sh status  # Inspect adapter, upstream, power, pause, and PF state
./ethernet-share.sh logs    # Follow the last 100 log lines; Ctrl+C to exit
```

Sharing starts when the selected adapter is present, its Ethernet link is up, the
configured upstream is primary and has a non-link-local IPv4 address, and automation
is enabled. It stops when any of these conditions disappears. Power-source changes
are logged; both AC and battery operation are supported.

The daemon handles adapter/network/power notifications and reconciles every ten
seconds while the Mac is awake. It works at the lock screen after the Mac has booted.
A sleeping Mac is not guaranteed to wake on adapter insertion. FileVault unlock,
USB accessory permission, or Wi-Fi authentication may require user interaction.

## Power and network behavior

- While sharing, the daemon uses the undocumented, system-wide `pmset disablesleep`
  setting to keep the Mac awake, including with the lid closed. It restores the
  previous value on cleanup. Display sleep and other power settings are unchanged.
  Battery sharing can drain the battery; keep the Mac on a ventilated surface and
  disconnect the adapter before putting it in a bag.
- Removing the adapter or losing connectivity restores settings. If the lid is
  closed, the daemon then requests sleep. No wake timers are installed.
- A persistent recovery journal records changes before they occur. Startup attempts
  cleanup after a crash; failures retain the journal for retry. Across boots only
  the persistent sleep setting is restored, not stale PF/interface state.
- Rules live in `com.apple/ethernetshare`, using Apple's existing wildcard hooks.
  The daemon never replaces the root PF ruleset or disables PF globally. It releases
  only its own PF reference token. A crash at token acquisition can still leave an
  orphaned reference; inspect `sudo pfctl -s References` if necessary.
- NAT is limited to the client's `/32` address. Incoming traffic from that client to
  the Mac itself is blocked; IPv6 on the downstream interface is blocked. An IP
  address is not authentication. No inbound port forwarding is configured.
- IPv4 forwarding is global. The daemon refuses to start if it is already enabled.
  Do not run another router, Internet Sharing service, or this project's older
  service at the same time. VPN coexistence is not supported.
- Cleanup reads IPv4 forwarding again after all other network teardown actions. If
  the first restoration raced with a network event, it writes the original value
  once more. It does not delete the recovery journal or log `settings-restored=true`
  until the restored value has been verified.

## Updates and removal

For code updates with the **same configuration**:

```bash
bash tests/check.sh
sudo bash install.sh
```

Identical installations leave the running service uninterrupted. Real upgrades
stage and validate new files, preserve the pause state, and attempt rollback if
installation fails. Sharing can briefly disconnect during an upgrade.

Before changing the adapter or upstream configuration, stop and uninstall the
existing service so its compiled configuration can clean up its own session:

```bash
./ethernet-share.sh stop
sudo bash uninstall.sh
# Edit Configuration.local.swift, then build and install again.
```

Uninstallation retains recovery state and logs. A retained state directory means a
later installation preserves the existing pause state instead of treating it as a
fresh installation. Installed paths are:

| Purpose | Path |
| --- | --- |
| Daemon | `/Library/PrivilegedHelperTools/local.ethernetshare/ethernetshared` |
| Launch daemon | `/Library/LaunchDaemons/local.ethernetshare.plist` |
| Recovery journal | `/var/db/ethernetshare/` |
| Logs | `/var/log/ethernetshare.log` |
| Log rotation | `/etc/newsyslog.d/local.ethernetshare.conf` |

The root service runs the installed binary, never source or scripts from the clone.
State is root-only; logs have mode `0600` and rotate at 1 MB with seven compressed copies.

## Troubleshooting and recovery

Start with `./ethernet-share.sh status` and `./ethernet-share.sh logs`.
The daemon fails closed when another network configuration owns forwarding, an
IPv4 address, or the sleep override, or when required PF hooks are unavailable.
Investigate the existing configuration instead of resetting system-wide settings.

For manual recovery, stop the launch daemon before taking its exclusive lock:

```bash
sudo launchctl bootout system/local.ethernetshare
sudo /Library/PrivilegedHelperTools/local.ethernetshare/ethernetshared recover
sudo launchctl bootstrap system /Library/LaunchDaemons/local.ethernetshare.plist
```

If migrating from an earlier version with a different service name, stop and
uninstall that version using its own checkout first. Do not run both versions.
The original prototype and documentation remain available in Git history; they
are not supported installation instructions for this version.

## Development and validation

```bash
bash tests/check.sh
.build/ethernetshared rules     # Print rules without installing them
.build/ethernetshared observe   # Watch conditions without changing network/power settings
```

Checks compile Swift with warnings as errors, validate shell/plist/log formats,
exercise the child-process helper, and test policy, recovery, partial-start failures,
cleanup retries, event coalescing, pause expiry, and power-loss recovery using
simulated system commands. PF syntax is parsed without loading rules.
These tests do not install the service or change network/power settings.

Hardware acceptance remains manual: verify client connectivity, unplug/replug,
upstream loss, pause/resume, AC-to-battery transition, lid close/open, daemon restart,
and reboot recovery on the intended Mac. Closed-lid behavior is not guaranteed.

Contributions are welcome through issues and pull requests. Include your macOS
version, adapter model, reproduction steps, and sanitized logs when reporting bugs.

## License

MIT. See [LICENSE](LICENSE).
