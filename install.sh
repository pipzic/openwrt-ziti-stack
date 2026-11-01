#!/bin/sh
# shellcheck shell=dash
# Add the openwrt-ziti-stack feed and install its packages on OpenWrt.
#   install.sh [package...]
# Without arguments it installs ziti-edge-tunnel only. Optional package:
# luci-app-ziti.
set -eu

FEED=https://pipzic.github.io/openwrt-ziti-stack
KEY_NAME=openwrt-ziti-stack.pem
KEY_SHA256=a479efa32458cbd16fba98ed2b0dc2d921329312490729739a04f6531d56ceae

[ -r /etc/openwrt_release ] && [ -r /etc/apk/arch ] || {
	echo "This script needs OpenWrt 25.12 or newer." >&2
	exit 1
}
. /etc/openwrt_release
ARCH="$(head -n 1 /etc/apk/arch)"
REPO="$FEED/$DISTRIB_RELEASE/$ARCH/packages.adb"

uclient-fetch -q -O /dev/null "$REPO" || {
	echo "No packages for OpenWrt $DISTRIB_RELEASE on $ARCH." >&2
	exit 1
}

TMP_KEY="/tmp/$KEY_NAME"
uclient-fetch -q -O "$TMP_KEY" "$FEED/$KEY_NAME"
echo "$KEY_SHA256  $TMP_KEY" | sha256sum -c -
mkdir -p /etc/apk/keys /etc/apk/repositories.d
mv "$TMP_KEY" "/etc/apk/keys/$KEY_NAME"
echo "$REPO" > /etc/apk/repositories.d/openwrt-ziti-stack.list

apk update
[ "$#" -gt 0 ] || set -- ziti-edge-tunnel
apk add "$@"
