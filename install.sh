#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ $EUID -ne 0 ]]; then
  echo "Build first: bash build.sh; then install: sudo bash install.sh" >&2
  exit 1
fi
[[ -x .build/ps5shared ]] || { echo "Run bash build.sh as your normal user first." >&2; exit 1; }
/usr/bin/plutil -lint local.ps5share.plist
/usr/sbin/newsyslog -n -f local.ps5share.newsyslog.conf >/dev/null
.build/ps5shared self-test
.build/ps5shared process-test
destination=/Library/PrivilegedHelperTools/local.ps5share
plist=/Library/LaunchDaemons/local.ps5share.plist
newsyslog=/etc/newsyslog.d/local.ps5share.conf
daemon="$destination/ps5shared"
if [[ -L "$destination" || -L /var/db/ps5share || -L /var/log/ps5share.log || -L "$plist" || -L "$newsyslog" ]]; then
  echo "Refusing symlink installation/state/log target." >&2
  exit 1
fi
if /bin/launchctl print system/local.ps5share >/dev/null 2>&1; then
  /bin/launchctl bootout system/local.ps5share || true
fi

# Releases affected by the old output-pipe bug can remain SIGTERMed after bootout.
# Match the exact installed command before escalating; never kill unrelated helpers.
for _ in 1 2 3 4 5; do
  old_pids=$(/usr/bin/pgrep -f '^/Library/PrivilegedHelperTools/local[.]ps5share/ps5shared watch$' || true)
  [[ -z "$old_pids" ]] && break
  /bin/sleep 1
done
if [[ -n "${old_pids:-}" ]]; then
  while IFS= read -r old_pid; do
    [[ "$old_pid" =~ ^[0-9]+$ ]] || { echo "Invalid daemon PID: $old_pid" >&2; exit 1; }
    old_command=$(/bin/ps -p "$old_pid" -o command=)
    [[ "$old_command" == "$daemon watch" ]] || {
      echo "Refusing to kill unexpected process $old_pid: $old_command" >&2
      exit 1
    }
    echo "Stopping unresponsive old daemon (pid $old_pid)..."
    /bin/kill -KILL "$old_pid"
  done <<< "$old_pids"
  /bin/sleep 1
  /bin/launchctl bootout system/local.ps5share >/dev/null 2>&1 || true
fi

/usr/bin/install -d -o root -g wheel -m 755 "$destination"
/usr/bin/install -o root -g wheel -m 755 .build/ps5shared "$daemon"
# Use the validated new binary for recovery so upgrades can repair older releases.
"$daemon" recover
/usr/bin/install -o root -g wheel -m 644 local.ps5share.plist "$plist"
/usr/bin/install -o root -g wheel -m 644 local.ps5share.newsyslog.conf "$newsyslog"
# First installation starts paused. Observation and migration can be checked before activation.
if [[ ! -d /var/db/ps5share ]]; then
  /usr/bin/install -d -o root -g wheel -m 700 /var/db/ps5share
  /usr/sbin/sysctl -n kern.boottime > /var/db/ps5share/paused
  /usr/sbin/chown root:wheel /var/db/ps5share/paused
  /bin/chmod 600 /var/db/ps5share/paused
fi
/usr/bin/touch /var/log/ps5share.log
/usr/sbin/chown root:wheel /var/log/ps5share.log
/bin/chmod 600 /var/log/ps5share.log
/bin/launchctl enable system/local.ps5share
/bin/launchctl bootstrap system "$plist"
echo "Installed. Run ./ps5-share.sh status; ./ps5-share.sh start resumes automation."
