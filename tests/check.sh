#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
bash -n build.sh install.sh uninstall.sh ps5-share.sh
/usr/bin/plutil -lint local.ps5share.plist
bash build.sh
.build/ps5shared self-test
.build/ps5shared process-test
xcrun swiftc -D TESTING -warnings-as-errors Sources/PS5Share.swift -o .build/ps5share-tests
.build/ps5share-tests self-test
# pfctl parses rules without loading them; this must never use -f without -n.
.build/ps5shared rules | /sbin/pfctl -nf -
echo "Build, policy checks, shell/plist and PF syntax passed. Hardware acceptance tests remain manual."
