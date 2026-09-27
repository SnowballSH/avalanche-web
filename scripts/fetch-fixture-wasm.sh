#!/usr/bin/env bash
# Builds the integration-test fixture wasm (pin master-8c66796) into .cache/fixtures,
# or reuses the copy already there. Prints the fixture path.
#
#   scripts/fetch-fixture-wasm.sh
#
# AVALANCHE_REPO names a local clone whose objects are checked out into a scratch
# worktree; otherwise the commit is shallow-fetched from GitHub. Neither mode touches
# an existing working tree.
set -euo pipefail

commit=8c66796067c944c0188c62ee9254b8f421ffd19e
zig_version=0.16.0
upstream="https://github.com/SnowballSH/Avalanche"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cache="$root/.cache/fixtures"
fixture="$cache/avalanche-${commit:0:7}.wasm"

if [[ -f "$fixture" ]]; then
	echo "$fixture"
	exit 0
fi

actual_zig="$(zig version)"
if [[ "$actual_zig" != "$zig_version" ]]; then
	echo "fetch-fixture-wasm: zig $zig_version required, found $actual_zig" >&2
	exit 1
fi

scratch="$(mktemp -d)"
checkout="$scratch/avalanche"
cleanup() {
	if [[ -n "${AVALANCHE_REPO:-}" && -d "$checkout" ]]; then
		git -C "$AVALANCHE_REPO" worktree remove --force "$checkout" >/dev/null 2>&1 || true
	fi
	rm -rf "$scratch"
}
trap cleanup EXIT

if [[ -n "${AVALANCHE_REPO:-}" ]]; then
	git -C "$AVALANCHE_REPO" worktree add --quiet --detach "$checkout" "$commit"
else
	git init --quiet "$checkout"
	git -C "$checkout" fetch --quiet --depth 1 "$upstream" "$commit"
	git -C "$checkout" checkout --quiet --detach FETCH_HEAD
fi

(cd "$checkout" && zig build wasm --release=fast) >&2

mkdir -p "$cache"
cp "$checkout/zig-out/web/avalanche.wasm" "$fixture.partial"
mv "$fixture.partial" "$fixture"
echo "$fixture"
