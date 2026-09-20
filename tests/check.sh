#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
bash -n build.sh install.sh uninstall.sh ethernet-share.sh
/usr/bin/plutil -lint local.ethernetshare.plist
/usr/bin/awk 'NF && $1 !~ /^#/ { if (NF != 7 || $1 != "/var/log/ethernetshare.log" || $7 !~ /N/) exit 1; found=1 } END { exit !found }' local.ethernetshare.newsyslog.conf
bash build.sh
.build/ethernetshared self-test
.build/ethernetshared process-test
xcrun swiftc -D TESTING -warnings-as-errors Sources/main.swift Configuration.example.swift -o .build/ethernetshare-tests
.build/ethernetshare-tests self-test
# pfctl parses rules without loading them; this must never use -f without -n.
.build/ethernetshared rules | /sbin/pfctl -nf -
echo "Build, policy checks, shell/plist and PF syntax passed. Hardware acceptance tests remain manual."
