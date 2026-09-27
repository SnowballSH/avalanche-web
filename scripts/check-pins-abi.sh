#!/usr/bin/env bash
# Gates every built pin in <outdir> on the recorded ABI. Fails when the catalogue
# lists no pin, when a pin's wasm is missing, or when any wasm's imports or exports
# differ from vendor/avalanche-web-abi1/abi.json.
#
#   scripts/check-pins-abi.sh <outdir>
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
catalogue="$root/engines/pins.json"

outdir="${1:-}"
if [[ -z "$outdir" ]]; then
	echo "usage: $0 <outdir>" >&2
	exit 2
fi

pins="$(node "$root/scripts/pins-catalogue.ts" list "$catalogue")"
if [[ -z "$pins" ]]; then
	echo "check-pins-abi: $catalogue lists no pins" >&2
	exit 1
fi

checked=0
while IFS=$'\t' read -r id _commit; do
	wasm="$outdir/engines/$id/avalanche.wasm"
	if [[ ! -f "$wasm" ]]; then
		echo "check-pins-abi: $wasm is missing" >&2
		exit 1
	fi
	node "$root/scripts/check-abi.ts" "$wasm"
	checked=$((checked + 1))
done <<<"$pins"

if [[ "$checked" -eq 0 ]]; then
	echo "check-pins-abi: no pin was checked" >&2
	exit 1
fi
echo "check-pins-abi: $checked pin(s) match the recorded ABI"
