#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p .build
configuration=Configuration.local.swift
[[ -f "$configuration" ]] || configuration=Configuration.example.swift
xcrun swiftc -O -warnings-as-errors Sources/main.swift "$configuration" -o .build/ethernetshared
echo "Built .build/ethernetshared"
