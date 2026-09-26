#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
command -v node >/dev/null || { echo 'Node.js 20.19+ is required for the dashboard.' >&2; exit 1; }
case "${1:-serve}" in
  start|stop|status|uninstall|open) exec node dashboard/manage.mjs "$1" ;;
  serve|install) ;;
  *) echo "Usage: $0 {serve|install|open|start|stop|status|uninstall}" >&2; exit 1 ;;
esac
if [[ ! -x .build/ethernetshared || Sources/main.swift -nt .build/ethernetshared ]]; then bash build.sh; fi
if [[ ! -d dashboard/node_modules ]]; then npm ci --prefix dashboard; fi
npm run build --prefix dashboard
if [[ "${1:-serve}" == install ]]; then exec node dashboard/manage.mjs install; fi
exec node dashboard/server.mjs
