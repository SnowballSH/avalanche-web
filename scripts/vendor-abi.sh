#!/usr/bin/env bash
# Vendors the Avalanche web bindings (web/src and LICENSE) from one commit into
# vendor/avalanche-web-abi1, or with --check verifies the vendored tree matches it.
#
#   scripts/vendor-abi.sh <commit> [--check]
#
# AVALANCHE_REPO names a local clone to read the commit from; otherwise the commit
# is fetched from GitHub. Neither mode reads a working tree: only the commit's objects.
set -euo pipefail

usage() {
	echo "usage: $0 <commit> [--check]" >&2
	exit 2
}

commit=""
check=0
for arg in "$@"; do
	case "$arg" in
	--check) check=1 ;;
	-*) usage ;;
	*)
		[[ -z "$commit" ]] || usage
		commit="$arg"
		;;
	esac
done
[[ -n "$commit" ]] || usage

upstream="https://github.com/SnowballSH/Avalanche"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target="$root/vendor/avalanche-web-abi1"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT

if [[ -n "${AVALANCHE_REPO:-}" ]]; then
	source_repo="$AVALANCHE_REPO"
else
	source_repo="$scratch/upstream.git"
	git init --quiet --bare "$source_repo"
	git -C "$source_repo" fetch --quiet --depth 1 "$upstream" "$commit"
fi

full_commit="$(git -C "$source_repo" rev-parse --verify "${commit}^{commit}")"

extracted="$scratch/extracted"
mkdir -p "$extracted/src"
git -C "$source_repo" archive --format=tar "$full_commit" web/src | tar -x -C "$extracted/src" --strip-components=2
git -C "$source_repo" show "$full_commit:LICENSE" >"$extracted/LICENSE"
cat >"$extracted/SOURCE" <<EOF
repository: $upstream
commit: $full_commit
paths: web/src -> src, LICENSE -> LICENSE
EOF

if [[ "$check" -eq 1 ]]; then
	[[ -d "$target" ]] || {
		echo "vendor-abi: $target does not exist" >&2
		exit 1
	}
	if diff -r "$extracted" "$target" --exclude=abi.json >&2; then
		echo "vendor-abi: $target matches $full_commit"
	else
		echo "vendor-abi: $target drifted from $full_commit" >&2
		exit 1
	fi
	exit 0
fi

mkdir -p "$target"
find "$target" -mindepth 1 -not -name abi.json -delete
cp -R "$extracted"/. "$target"/
echo "vendor-abi: vendored $full_commit into $target"
