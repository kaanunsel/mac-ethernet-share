#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ $EUID -ne 0 ]]; then
  echo "Build first: bash build.sh; then install: sudo bash install.sh" >&2
  exit 1
fi
[[ -x .build/ps5shared ]] || { echo "Run bash build.sh as your normal user first." >&2; exit 1; }
/usr/bin/plutil -lint local.ps5share.plist
.build/ps5shared self-test
destination=/Library/PrivilegedHelperTools/local.ps5share
plist=/Library/LaunchDaemons/local.ps5share.plist
if [[ -L "$destination" || -L /var/db/ps5share || -L /var/log/ps5share.log || -L "$plist" ]]; then
  echo "Refusing symlink installation/state/log target." >&2
  exit 1
fi
if /bin/launchctl print system/local.ps5share >/dev/null 2>&1; then
  /bin/launchctl bootout system/local.ps5share
fi
# Recovery must succeed before replacing a previous binary.
if [[ -x "$destination/ps5shared" ]]; then "$destination/ps5shared" recover; fi
/usr/bin/install -d -o root -g wheel -m 755 "$destination"
/usr/bin/install -o root -g wheel -m 755 .build/ps5shared "$destination/ps5shared"
/usr/bin/install -o root -g wheel -m 644 local.ps5share.plist "$plist"
# First installation starts paused. Observation and migration can be checked before activation.
if [[ ! -d /var/db/ps5share ]]; then
  /usr/bin/install -d -o root -g wheel -m 700 /var/db/ps5share
  /usr/bin/install -o root -g wheel -m 600 /dev/null /var/db/ps5share/paused
fi
/usr/bin/touch /var/log/ps5share.log
/usr/sbin/chown root:wheel /var/log/ps5share.log
/bin/chmod 600 /var/log/ps5share.log
/bin/launchctl enable system/local.ps5share
/bin/launchctl bootstrap system "$plist"
echo "Installed. Run ./ps5-share.sh status; ./ps5-share.sh start resumes automation."
