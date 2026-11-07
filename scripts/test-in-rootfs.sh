#!/bin/sh
# shellcheck shell=dash
# One test case, run inside a fresh, disposable OpenWrt rootfs container.
#   test-in-rootfs.sh <case> <release>
#
# The container is not a booted router: there is no procd, ubus, or tunnel.
set -eu

test_case="$1"
release="$2"
ARCH=aarch64_cortex-a53
FEED="/feed/$release/$ARCH"

fail() {
	echo "FAIL: $*" >&2
	exit 1
}

# Prepare what a boot would have created. The armsr image is aarch64_generic;
# adding the second architecture lets it accept this feed's packages.
prepare() {
	mkdir -p /var/lock /var/run /var/log /tmp/.uci
	printf 'aarch64_generic\n%s\n' "$ARCH" > /etc/apk/arch
}

use_feed() {
	echo "$1/packages.adb" > /etc/apk/repositories.d/openwrt-ziti-stack.list
}

trust_feed() {
	cp /feed/openwrt-ziti-stack.pem /etc/apk/keys/
}

expect_equal() {
	[ "$2" = "$3" ] || fail "$1: expected '$3', got '$2'"
}

case_install() {
	prepare
	trust_feed
	use_feed "$FEED"
	apk update
	apk add --no-scripts ziti-edge-tunnel luci-app-ziti

	ziti-edge-tunnel version
	curl --version >/dev/null || fail "curl is missing"
	[ -f /www/luci-static/resources/view/ziti/status.js ] || fail "LuCI views are missing"
	[ -s /usr/lib/lua/luci/i18n/ziti.ru.lmo ] || fail "the translation is missing"
	/usr/libexec/ziti-boot-guard identities | jsonfilter -e '@' >/dev/null || fail "guard identities"
	/usr/libexec/rpcd/ziti list | jsonfilter -e '@.set_identity' >/dev/null || fail "rpcd set_identity"

	/usr/libexec/rpcd/ziti list | jsonfilter -e '@.check_update' >/dev/null || fail "rpcd list"
	result="$(/usr/libexec/rpcd/ziti call check_update </dev/null)"
	echo "$result"
	[ -n "$(echo "$result" | jsonfilter -e '@.installed')" ] || fail "check_update reports no installed version"
	expect_equal "feed in check_update" "$(echo "$result" | jsonfilter -e '@.feed')" "$FEED/packages.adb"

	# The mixed-architecture database must stay usable for later commands.
	apk list -I ziti-edge-tunnel | grep -q '^ziti-edge-tunnel-' || fail "apk lost the installed package"

	# apk only warns about an untrusted index, so the update check must report it.
	rm /etc/apk/keys/openwrt-ziti-stack.pem
	result="$(/usr/libexec/rpcd/ziti call check_update </dev/null)"
	echo "$result"
	expect_equal "check_update without the key" "$(echo "$result" | jsonfilter -e '@.error.code')" update_failed
}

case_wrong_key() {
	prepare
	# Our key stays out: only OpenWrt's own key is trusted.
	use_feed "$FEED"
	apk update || true
	if apk add --no-scripts ziti-edge-tunnel; then
		fail "installed from an index signed by an untrusted key"
	fi
	# Prove the failure came from trust, not from an unreadable index.
	apk --allow-untrusted list ziti-edge-tunnel | grep -q '^ziti-edge-tunnel-' \
		|| fail "the index was not readable, so the check proved nothing"
}

case_tampered() {
	prepare
	trust_feed
	mkdir -p /tmp/feed
	cp "$FEED"/* /tmp/feed/
	for package in /tmp/feed/ziti-edge-tunnel-*.apk; do
		printf 'tampered' >> "$package"
	done
	use_feed /tmp/feed
	apk update
	apk list ziti-edge-tunnel | grep -q '^ziti-edge-tunnel-' \
		|| fail "the index was not readable, so the check proved nothing"
	if apk add --no-cache --no-scripts ziti-edge-tunnel; then
		fail "installed a modified package"
	fi
	if apk list -I ziti-edge-tunnel | grep -q '^ziti-edge-tunnel-'; then
		fail "a modified package is recorded as installed"
	fi
}

case "$test_case" in
	install)   case_install ;;
	wrong-key) case_wrong_key ;;
	tampered)  case_tampered ;;
	*)         fail "unknown test case: $test_case" ;;
esac
echo "PASS: $test_case on $release"
