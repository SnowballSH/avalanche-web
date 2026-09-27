#!/usr/bin/env bash
# Builds every pin in engines/pins.json into <outdir>/engines/<id>/avalanche.wasm,
# gates each build on the recorded ABI, emits precompressed .zst and .gz siblings,
# and writes the served catalogue <outdir>/engines/pins.json with each pin's sha256
# and byte count (both of the uncompressed wasm). Any build failure or ABI
# mismatch exits non-zero.
#
#   scripts/build-pins.sh <outdir>
#
# Needs git, zig 0.16.0, node, zstd and gzip. See docs/pins.md.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
catalogue="$root/engines/pins.json"

outdir="${1:-}"
if [[ -z "$outdir" ]]; then
	echo "usage: $0 <outdir>" >&2
	exit 2
fi

missing=()
for tool in git zig node zstd gzip; do
	command -v "$tool" >/dev/null 2>&1 || missing+=("$tool")
done
if [[ ${#missing[@]} -gt 0 ]]; then
	echo "build-pins: missing required tools: ${missing[*]}" >&2
	exit 1
fi

pins="$(node "$root/scripts/pins-catalogue.ts" list "$catalogue")"

rm -rf "$outdir/engines"
mkdir -p "$outdir/engines"

while IFS=$'\t' read -r id commit; do
	wasm="$outdir/engines/$id/avalanche.wasm"
	echo "build-pins: pin $id ($commit)" >&2
	"$root/scripts/build-avalanche-wasm.sh" "$commit" "$wasm" "$id"
	node "$root/scripts/check-abi.ts" "$wasm"
	zstd --quiet --force --ultra -22 -T0 "$wasm" -o "$wasm.zst"
	gzip --best --no-name --keep --force "$wasm"
done <<<"$pins"

node "$root/scripts/pins-catalogue.ts" emit "$catalogue" "$outdir"
