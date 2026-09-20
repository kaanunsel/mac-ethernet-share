#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p .build
xcrun swiftc -O -warnings-as-errors Sources/PS5Share.swift -o .build/ps5shared
echo "Built .build/ps5shared"
