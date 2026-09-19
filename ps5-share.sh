#!/bin/bash

# PS5 Internet sharing over MacBook Ethernet adapter
# Wi-Fi / eduroam side: en0
# PS5 Ethernet side: en9
#
# NAT cannot run while the Mac is actually asleep. While sharing is active
# this script keeps the Mac awake on AC power (lid close included) so the
# PS5 still has a live gateway. Display sleep is left alone.

set -e

WIFI_IF="en0"
PS5_IF="en9"
PS5_GATEWAY_IP="192.168.2.1"
PS5_SUBNET="192.168.2.0/24"
PF_CONF="/tmp/ps5share.conf"
PMSET_STATE="/tmp/ps5share.pmset"
CAFFEINATE_PID="/tmp/ps5share.caffeinate.pid"

pmset_ac_value() {
  local key="$1"
  pmset -g custom | awk -v key="$key" '
    /^AC Power:/ { in_ac = 1; next }
    /^[A-Za-z].*:/ { in_ac = 0 }
    in_ac && $1 == key { print $2; exit }
  '
}

current_sleep_disabled() {
  pmset -g | awk '/SleepDisabled/ { print $2; exit }'
}

enable_keep_awake() {
  if [[ ! -f "$PMSET_STATE" ]]; then
    {
      echo "SLEEP_AC=$(pmset_ac_value sleep)"
      echo "SLEEPDISABLED=$(current_sleep_disabled)"
    } > "$PMSET_STATE"
  fi

  # Never idle-sleep on charger, and do not sleep when the lid is closed.
  sudo pmset -c sleep 0
  sudo pmset -c disablesleep 1

  if [[ -f "$CAFFEINATE_PID" ]] && kill -0 "$(cat "$CAFFEINATE_PID")" 2>/dev/null; then
    :
  else
    caffeinate -ims >/dev/null 2>&1 &
    echo $! > "$CAFFEINATE_PID"
  fi
}

disable_keep_awake() {
  if [[ -f "$CAFFEINATE_PID" ]]; then
    kill "$(cat "$CAFFEINATE_PID")" 2>/dev/null || true
    rm -f "$CAFFEINATE_PID"
  fi

  if [[ ! -f "$PMSET_STATE" ]]; then
    sudo pmset -c disablesleep 0
    return
  fi

  # shellcheck disable=SC1090
  source "$PMSET_STATE"

  sudo pmset -c disablesleep "${SLEEPDISABLED:-0}"
  if [[ -n "${SLEEP_AC}" ]]; then
    sudo pmset -c sleep "$SLEEP_AC"
  fi

  rm -f "$PMSET_STATE"
}

start_share() {
  echo "Starting PS5 internet sharing..."

  # Enable IPv4 packet forwarding
  sudo sysctl -w net.inet.ip.forwarding=1

  # Assign gateway IP to the Ethernet adapter connected to PS5
  sudo ifconfig "$PS5_IF" inet "$PS5_GATEWAY_IP" netmask 255.255.255.0 up

  # Create temporary PF NAT rules
  sudo tee "$PF_CONF" > /dev/null <<EOF
nat on $WIFI_IF from $PS5_SUBNET to any -> ($WIFI_IF)

pass quick on $PS5_IF all keep state
pass quick on $WIFI_IF all keep state
EOF

  # Validate PF config before loading
  sudo pfctl -nf "$PF_CONF"

  # Load PF config and enable PF
  sudo pfctl -f "$PF_CONF"
  sudo pfctl -e 2>/dev/null || true

  enable_keep_awake

  echo ""
  echo "Done. Use these PS5 manual network settings:"
  echo "IP Address:        192.168.2.2"
  echo "Subnet Mask:       255.255.255.0"
  echo "Default Gateway:   192.168.2.1"
  echo "Primary DNS:       1.1.1.1"
  echo "Secondary DNS:     8.8.8.8"
  echo ""
  echo "Keep-awake: the Mac stays awake on charger (including lid closed)"
  echo "so NAT keeps running. The display can still sleep. Plug in power."
  echo "Run ./ps5-share.sh stop to restore normal sleep."
  echo ""
  echo "Current NAT rules:"
  sudo pfctl -sn
}

stop_share() {
  echo "Stopping PS5 internet sharing..."

  disable_keep_awake

  # Disable PF and IP forwarding
  sudo pfctl -d 2>/dev/null || true
  sudo sysctl -w net.inet.ip.forwarding=0

  # Remove temporary PF config
  sudo rm -f "$PF_CONF"

  echo "Stopped. Normal sleep settings restored."
}

status_share() {
  echo "IP forwarding:"
  sysctl net.inet.ip.forwarding

  echo ""
  echo "$PS5_IF IP:"
  ifconfig "$PS5_IF" | grep inet || true

  echo ""
  echo "PF NAT rules:"
  sudo pfctl -sn || true

  echo ""
  echo "PF filter rules:"
  sudo pfctl -sr || true

  echo ""
  echo "Keep-awake:"
  if [[ -f "$CAFFEINATE_PID" ]] && kill -0 "$(cat "$CAFFEINATE_PID")" 2>/dev/null; then
    echo "caffeinate: running (pid $(cat "$CAFFEINATE_PID"))"
  else
    echo "caffeinate: not running"
  fi
  pmset -g | grep -E 'SleepDisabled|[[:space:]]sleep[[:space:]]' || true
  pmset -g ps | head -n 1
}

case "$1" in
  start)
    start_share
    ;;
  stop)
    stop_share
    ;;
  status)
    status_share
    ;;
  *)
    echo "Usage: $0 {start|stop|status}"
    exit 1
    ;;
esac
