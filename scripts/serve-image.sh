#!/usr/bin/env bash
# Runs a built site image on 127.0.0.1:<port> the way the host does (read-only
# root, tmpfs /config /data /tmp, every capability dropped, no new privileges)
# and stays in the foreground, streaming its log, until interrupted; the
# container is removed on exit. The served-image e2e suite
# (playwright.served.config.ts) starts it.
#
#   scripts/serve-image.sh [image] [port]
#
# image defaults to AVALANCHE_IMAGE or avalanche-web:local, port to 8080.
# CONTAINER_ENGINE picks podman or docker; otherwise podman when installed.
set -euo pipefail

image="${1:-${AVALANCHE_IMAGE:-avalanche-web:local}}"
port="${2:-8080}"
engine="${CONTAINER_ENGINE:-$(command -v podman >/dev/null 2>&1 && echo podman || echo docker)}"
name="avalanche-web-serve-${port}"

stop() {
	"$engine" rm --force "$name" >/dev/null 2>&1 || true
}
stop
trap stop EXIT
trap 'exit 143' TERM INT

tmpfs_options="rw,noexec,nosuid,nodev,size=8m"
"$engine" run --detach --name "$name" \
	--publish "127.0.0.1:${port}:8080" \
	--read-only \
	--tmpfs "/config:${tmpfs_options}" \
	--tmpfs "/data:${tmpfs_options}" \
	--tmpfs "/tmp:${tmpfs_options}" \
	--cap-drop ALL \
	--security-opt no-new-privileges \
	"$image" >/dev/null

"$engine" logs --follow "$name" &
wait $!
