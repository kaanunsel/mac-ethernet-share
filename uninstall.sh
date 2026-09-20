#!/bin/bash
set -euo pipefail
if [[ $EUID -ne 0 ]]; then echo "Usage: sudo bash uninstall.sh" >&2; exit 1; fi
destination=/Library/PrivilegedHelperTools/local.ethernetshare
if /bin/launchctl print system/local.ethernetshare >/dev/null 2>&1; then
  /bin/launchctl bootout system/local.ethernetshare
fi
# Preserve recovery state and installed binary if cleanup fails.
if [[ -x "$destination/ethernetshared" ]]; then "$destination/ethernetshared" recover; fi
/bin/rm -f /Library/LaunchDaemons/local.ethernetshare.plist "$destination/ethernetshared"
/bin/rm -f /etc/newsyslog.d/local.ethernetshare.conf
if [[ -d "$destination" ]]; then /bin/rmdir "$destination"; fi
echo "Service removed. Recovery directory and logs retained in /var/db/ethernetshare and /var/log/ethernetshare.log."
