#!/usr/bin/env bash
# Builds the integration-test fixture wasm (pin master-9b7ee6f) into .cache/fixtures,
# or reuses the copy already there. Prints the fixture path.
#
#   scripts/fetch-fixture-wasm.sh
#
# The build itself is scripts/build-avalanche-wasm.sh, the same path the pins take;
# AVALANCHE_REPO and AVALANCHE_GIT_CACHE are honoured as documented there.
set -euo pipefail

pin_id=master-9b7ee6f
commit=9b7ee6ff829dcfb5ee5e48d8dcb83bd44c26a642
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture="$root/.cache/fixtures/avalanche-${commit:0:7}.wasm"

if [[ ! -f "$fixture" ]]; then
	"$root/scripts/build-avalanche-wasm.sh" "$commit" "$fixture" "$pin_id"
fi
echo "$fixture"
