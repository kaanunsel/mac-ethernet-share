#!/bin/bash
set -euo pipefail
binary=/Library/PrivilegedHelperTools/local.ps5share/ps5shared
case "${1:-status}" in
  start|stop|status|recover) ;;
  *) echo "Usage: $0 {start|stop|status|recover}" >&2; exit 1 ;;
esac
if [[ ! -x "$binary" ]]; then
  echo "Install first: bash build.sh && sudo bash install.sh" >&2
  exit 1
fi
exec sudo "$binary" "${1:-status}"
