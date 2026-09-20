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
daemon="$destination/ps5shared"
plist=/Library/LaunchDaemons/local.ps5share.plist
newsyslog=/etc/newsyslog.d/local.ps5share.conf
state_directory=/var/db/ps5share
log_file=/var/log/ps5share.log

if [[ -L "$destination" || -L "$state_directory" || -L "$log_file" || -L "$plist" || -L "$newsyslog" ]]; then
  echo "Refusing symlink installation/state/log target." >&2
  exit 1
fi

# Re-running an identical installation must not interrupt an active PS5 session.
if [[ -x "$daemon" && -f "$plist" && -f "$newsyslog" ]] &&
   /usr/bin/cmp -s .build/ps5shared "$daemon" &&
   /usr/bin/cmp -s local.ps5share.plist "$plist" &&
   /usr/bin/cmp -s local.ps5share.newsyslog.conf "$newsyslog" &&
   /bin/launchctl print system/local.ps5share >/dev/null 2>&1; then
  echo "Already up to date; running service was not interrupted."
  exit 0
fi

first_install=0
[[ -d "$state_directory" ]] || first_install=1
was_loaded=0
/bin/launchctl print system/local.ps5share >/dev/null 2>&1 && was_loaded=1

/usr/bin/install -d -o root -g wheel -m 755 "$destination"
stage=$(/usr/bin/mktemp -d "$destination/.install.XXXXXX")
/bin/chmod 700 "$stage"
/usr/bin/install -o root -g wheel -m 755 .build/ps5shared "$stage/new-daemon"
/usr/bin/install -o root -g wheel -m 644 local.ps5share.plist "$stage/new-plist"
/usr/bin/install -o root -g wheel -m 644 local.ps5share.newsyslog.conf "$stage/new-newsyslog"
"$stage/new-daemon" self-test >/dev/null
"$stage/new-daemon" process-test >/dev/null
/usr/bin/plutil -lint "$stage/new-plist" >/dev/null

had_daemon=0; had_plist=0; had_newsyslog=0
if [[ -f "$daemon" ]]; then /bin/cp -p "$daemon" "$stage/old-daemon"; had_daemon=1; fi
if [[ -f "$plist" ]]; then /bin/cp -p "$plist" "$stage/old-plist"; had_plist=1; fi
if [[ -f "$newsyslog" ]]; then /bin/cp -p "$newsyslog" "$stage/old-newsyslog"; had_newsyslog=1; fi

rollback_needed=0
finish_install() {
  result=$?
  set +e
  if [[ $result -ne 0 && $rollback_needed -eq 1 ]]; then
    echo "Installation failed; restoring the previous service files..." >&2
    /bin/launchctl bootout system/local.ps5share >/dev/null 2>&1
    if [[ $had_daemon -eq 1 ]]; then /usr/bin/install -o root -g wheel -m 755 "$stage/old-daemon" "$daemon"; else /usr/bin/unlink "$daemon" 2>/dev/null; fi
    if [[ $had_plist -eq 1 ]]; then /usr/bin/install -o root -g wheel -m 644 "$stage/old-plist" "$plist"; else /usr/bin/unlink "$plist" 2>/dev/null; fi
    if [[ $had_newsyslog -eq 1 ]]; then /usr/bin/install -o root -g wheel -m 644 "$stage/old-newsyslog" "$newsyslog"; else /usr/bin/unlink "$newsyslog" 2>/dev/null; fi
    if [[ $was_loaded -eq 1 && $had_daemon -eq 1 && $had_plist -eq 1 ]]; then
      /bin/launchctl bootstrap system "$plist" >/dev/null 2>&1
    fi
  fi
  for staged_file in new-daemon new-plist new-newsyslog old-daemon old-plist old-newsyslog; do
    [[ -e "$stage/$staged_file" ]] && /usr/bin/unlink "$stage/$staged_file"
  done
  /bin/rmdir "$stage" 2>/dev/null
  trap - EXIT
  exit "$result"
}
trap finish_install EXIT
rollback_needed=1

if [[ $was_loaded -eq 1 ]]; then
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

# Recover the stopped session with the validated new binary, then swap files.
"$stage/new-daemon" recover
/bin/mv -f "$stage/new-daemon" "$daemon"
/bin/mv -f "$stage/new-plist" "$plist"
/bin/mv -f "$stage/new-newsyslog" "$newsyslog"
/usr/sbin/chown root:wheel "$daemon" "$plist" "$newsyslog"
/bin/chmod 755 "$daemon"
/bin/chmod 644 "$plist" "$newsyslog"

if [[ $first_install -eq 1 ]]; then
  /usr/sbin/sysctl -n kern.boottime > "$state_directory/paused"
  /usr/sbin/chown root:wheel "$state_directory/paused"
  /bin/chmod 600 "$state_directory/paused"
fi
/usr/bin/touch "$log_file"
/usr/sbin/chown root:wheel "$log_file"
/bin/chmod 600 "$log_file"
/bin/launchctl enable system/local.ps5share
/bin/launchctl bootstrap system "$plist"
rollback_needed=0
echo "Installed safely. Existing pause/automatic state was preserved."
