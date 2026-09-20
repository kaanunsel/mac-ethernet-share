#!/bin/bash
set -euo pipefail
if [[ $EUID -ne 0 ]]; then echo "Usage: sudo bash uninstall.sh" >&2; exit 1; fi
destination=/Library/PrivilegedHelperTools/local.ps5share
if /bin/launchctl print system/local.ps5share >/dev/null 2>&1; then
  /bin/launchctl bootout system/local.ps5share
fi
# Preserve recovery state and installed binary if cleanup fails.
if [[ -x "$destination/ps5shared" ]]; then "$destination/ps5shared" recover; fi
/bin/rm -f /Library/LaunchDaemons/local.ps5share.plist "$destination/ps5shared"
/bin/rm -f /etc/newsyslog.d/local.ps5share.conf
if [[ -d "$destination" ]]; then /bin/rmdir "$destination"; fi
echo "Service removed. Recovery directory and logs retained in /var/db/ps5share and /var/log/ps5share.log."
