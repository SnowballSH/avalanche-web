#!/usr/bin/env bash
# Builds the integration-test fixture wasm (pin v5.0.0-3274054) into .cache/fixtures,
# or reuses the copy already there. Prints the fixture path.
#
#   scripts/fetch-fixture-wasm.sh
#
# The build itself is scripts/build-avalanche-wasm.sh, the same path the pins take;
# AVALANCHE_REPO and AVALANCHE_GIT_CACHE are honoured as documented there.
set -euo pipefail

pin_id=v5.0.0-3274054
commit=327405485fd943dbf0ccaac5539d3841d6e3e1a4
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture="$root/.cache/fixtures/avalanche-${commit:0:7}.wasm"

if [[ ! -f "$fixture" ]]; then
	"$root/scripts/build-avalanche-wasm.sh" "$commit" "$fixture" "$pin_id"
fi
echo "$fixture"
