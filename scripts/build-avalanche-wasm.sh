#!/usr/bin/env bash
# Builds Avalanche's wasm from a clean checkout of one commit and writes it to the
# given path. This is the single build path for pins and test fixtures.
#
#   scripts/build-avalanche-wasm.sh <commit> <destination.wasm> <version>
#
# <version> is passed as -Dversion, the string `uci` reports after "id name
# Avalanche"; pins pass their id. Without it the engine embeds the build timestamp
# and the module's bytes differ on every build.
#
# The commit's objects come from AVALANCHE_REPO, a local clone, when that is set;
# otherwise from a bare cache at AVALANCHE_GIT_CACHE (default .cache/avalanche.git),
# shallow-fetched from GitHub on first use. No working tree is ever read: the
# checkout is a `git archive` of the commit into a scratch directory.
set -euo pipefail

zig_version=0.16.0
upstream="https://github.com/SnowballSH/Avalanche"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

commit="${1:-}"
destination="${2:-}"
version="${3:-}"
if [[ -z "$commit" || -z "$destination" || -z "$version" ]]; then
	echo "usage: $0 <commit> <destination.wasm> <version>" >&2
	exit 2
fi

actual_zig="$(zig version)"
if [[ "$actual_zig" != "$zig_version" ]]; then
	echo "build-avalanche-wasm: zig $zig_version required, found $actual_zig" >&2
	exit 1
fi

if [[ -n "${AVALANCHE_REPO:-}" ]]; then
	source_repo="$AVALANCHE_REPO"
else
	source_repo="${AVALANCHE_GIT_CACHE:-$root/.cache/avalanche.git}"
	if [[ ! -d "$source_repo" ]]; then
		git init --quiet --bare "$source_repo"
	fi
	if ! git -C "$source_repo" cat-file -e "${commit}^{commit}" 2>/dev/null; then
		git -C "$source_repo" fetch --quiet --depth 1 "$upstream" "$commit"
	fi
fi

full_commit="$(git -C "$source_repo" rev-parse --verify "${commit}^{commit}")"

scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
checkout="$scratch/avalanche"
mkdir -p "$checkout"
git -C "$source_repo" archive --format=tar "$full_commit" | tar -x -C "$checkout"

echo "build-avalanche-wasm: building $full_commit as version $version" >&2
(cd "$checkout" && zig build wasm --release=fast "-Dversion=$version") >&2

mkdir -p "$(dirname "$destination")"
cp "$checkout/zig-out/web/avalanche.wasm" "$destination.partial"
mv "$destination.partial" "$destination"
echo "build-avalanche-wasm: wrote $destination" >&2
