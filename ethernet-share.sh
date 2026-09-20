#!/bin/bash
set -euo pipefail
binary=/Library/PrivilegedHelperTools/local.ethernetshare/ethernetshared
case "${1:-status}" in
  logs)
    exec sudo /usr/bin/tail -n 100 -F /var/log/ethernetshare.log
    ;;
  start|stop|status|recover) ;;
  *) echo "Usage: $0 {start|stop|status|logs|recover}" >&2; exit 1 ;;
esac
if [[ ! -x "$binary" ]]; then
  echo "Install first: bash build.sh && sudo bash install.sh" >&2
  exit 1
fi
exec sudo "$binary" "${1:-status}"
