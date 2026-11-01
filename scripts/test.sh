#!/usr/bin/env bash
# Run every test case against a signed feed in a fresh ARM64 OpenWrt container.
# Needs an arm64 host and the openwrt-ziti-stack-builder image built for it.
#   test.sh <release> <feed-dir>
set -euo pipefail

release="${1:?usage: test.sh <release> <feed-dir>}"
feed="$(cd "${2:?usage: test.sh <release> <feed-dir>}" && pwd)"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="openwrt-ziti-stack-test:$release"

# Official rootfs archive, verified through its signed sha256sums. OpenWrt's
# Docker Hub images carry a non-standard platform label that docker run rejects.
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
docker run --rm --user "$(id -u):$(id -g)" --env HOME=/tmp --volume "$work:/out" \
  --entrypoint /bin/bash openwrt-ziti-stack-builder -c \
  'source /opt/openwrt-ziti-stack/scripts/common.sh; verified_fetch "$1" armsr/armv8 "openwrt-[0-9.]+-armsr-armv8-rootfs\\.tar\\.gz" /out' \
  _ "$release"
docker import --platform linux/arm64 "$work"/openwrt-*-rootfs.tar.gz "$IMAGE" >/dev/null

for test_case in install gateway gateway-fail wrong-key tampered; do
  printf '=== %s: %s\n' "$release" "$test_case"
  docker run --rm --platform linux/arm64 \
    --volume "$feed:/feed:ro" --volume "$ROOT/scripts:/test:ro" \
    "$IMAGE" /bin/sh /test/test-in-rootfs.sh "$test_case" "$release"
done
docker rmi "$IMAGE" >/dev/null
printf 'all tests passed for %s\n' "$release"
