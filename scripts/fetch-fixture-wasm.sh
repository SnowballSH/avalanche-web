#!/usr/bin/env bash
# Builds the integration-test fixture wasm (pin master-8c66796) into .cache/fixtures,
# or reuses the copy already there. Prints the fixture path.
#
#   scripts/fetch-fixture-wasm.sh
#
# The build itself is scripts/build-avalanche-wasm.sh, the same path the pins take;
# AVALANCHE_REPO and AVALANCHE_GIT_CACHE are honoured as documented there.
set -euo pipefail

commit=8c66796067c944c0188c62ee9254b8f421ffd19e
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture="$root/.cache/fixtures/avalanche-${commit:0:7}.wasm"

if [[ ! -f "$fixture" ]]; then
	"$root/scripts/build-avalanche-wasm.sh" "$commit" "$fixture"
fi
echo "$fixture"
