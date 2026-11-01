#!/bin/sh
# shellcheck shell=dash
# One test case, run inside a fresh, disposable OpenWrt rootfs container.
#   test-in-rootfs.sh <case> <release>
#
# The container is not a booted router: there is no procd, ubus, or tunnel. The
# gateway cases replace fw4 and the firewall service with stubs, so they test the
# package logic only. Real firewall behaviour is checked on a real device.
set -eu

test_case="$1"
release="$2"
ARCH=aarch64_cortex-a53
FEED="/feed/$release/$ARCH"
GATEWAY=/usr/libexec/openwrt-ziti-gateway
STATE=/etc/config/openwrt_ziti_gateway

fail() {
	echo "FAIL: $*" >&2
	exit 1
}

# Prepare what a boot would have created. The armsr image is aarch64_generic;
# adding the second architecture lets it accept this feed's packages.
prepare() {
	mkdir -p /var/lock /var/run /var/log /tmp/.uci
	printf 'aarch64_generic\n%s\n' "$ARCH" > /etc/apk/arch
	cat > /etc/config/firewall <<-'EOF'
		config defaults
			option input 'REJECT'
			option output 'ACCEPT'
			option forward 'REJECT'
			option flow_offloading '1'

		config zone
			option name 'lan'
			list network 'lan'
			option input 'ACCEPT'
			option output 'ACCEPT'
			option forward 'ACCEPT'

		config zone
			option name 'wan'
			list network 'wan'
			option input 'REJECT'
			option output 'ACCEPT'
			option forward 'REJECT'
			option masq '1'

		config forwarding
			option src 'lan'
			option dest 'wan'
	EOF
}

use_feed() {
	echo "$1/packages.adb" > /etc/apk/repositories.d/openwrt-ziti-stack.list
}

trust_feed() {
	cp /feed/openwrt-ziti-stack.pem /etc/apk/keys/
}

stub_firewall() {
	printf '#!/bin/sh\nexit %s\n' "$1" > /sbin/fw4
	printf '#!/bin/sh\nexit 0\n' > /etc/init.d/firewall
	chmod 0755 /sbin/fw4 /etc/init.d/firewall
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

case_gateway() {
	prepare
	trust_feed
	use_feed "$FEED"
	stub_firewall 0
	apk update
	apk add --no-scripts ziti-edge-tunnel
	before="$(uci -q show firewall)"

	apk add openwrt-ziti-gateway
	expect_equal "zone" "$(uci -q get firewall.ziti_gateway_zone.name)" ziti
	expect_equal "forwarding" "$(uci -q get firewall.ziti_gateway_lan.dest)" ziti
	expect_equal "offload" "$(uci -q get 'firewall.@defaults[0].flow_offloading')" 0
	expect_equal "hardware offload" "$(uci -q get 'firewall.@defaults[0].flow_offloading_hw')" 0
	expect_equal "saved offload" "$(uci -q get openwrt_ziti_gateway.saved.flow_offloading)" 1
	uci -q get openwrt_ziti_gateway.saved.flow_offloading_hw && fail "an absent option was saved"

	# A repeat, as an upgrade runs it, must not overwrite the original values.
	"$GATEWAY" enable
	expect_equal "saved offload after repeat" "$(uci -q get openwrt_ziti_gateway.saved.flow_offloading)" 1

	apk del openwrt-ziti-gateway
	expect_equal "firewall after removal" "$(uci -q show firewall)" "$before"
	[ ! -e "$STATE" ] || fail "state file left after removal"
}

case_gateway_fail() {
	prepare
	trust_feed
	use_feed "$FEED"
	stub_firewall 1
	apk update
	apk add --no-scripts ziti-edge-tunnel
	before="$(uci -q show firewall)"

	if apk add openwrt-ziti-gateway; then
		fail "apk add succeeded although enabling the gateway failed"
	fi
	expect_equal "firewall after failed enable" "$(uci -q show firewall)" "$before"
	[ ! -e "$STATE" ] || fail "state file left after failed enable"
	apk list -I openwrt-ziti-gateway | grep -q '^openwrt-ziti-gateway-' \
		|| fail "the package should stay installed after a failed script"

	# The documented repair path.
	stub_firewall 0
	apk fix openwrt-ziti-gateway
	expect_equal "zone after repair" "$(uci -q get firewall.ziti_gateway_zone.name)" ziti

	# A failed enable on an existing installation keeps the existing state.
	saved="$(cat "$STATE")"
	stub_firewall 1
	if "$GATEWAY" enable; then
		fail "enable succeeded although fw4 failed"
	fi
	expect_equal "state after failed repeat" "$(cat "$STATE")" "$saved"

	# With LuCI managing the tunnel, removal changes nothing.
	stub_firewall 0
	uci set ziti.main.tunnel_mode=split
	uci commit ziti
	apk del openwrt-ziti-gateway
	expect_equal "zone kept for LuCI" "$(uci -q get firewall.ziti_gateway_zone.name)" ziti
	expect_equal "state kept for LuCI" "$(cat "$STATE")" "$saved"
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
	install)      case_install ;;
	gateway)      case_gateway ;;
	gateway-fail) case_gateway_fail ;;
	wrong-key)    case_wrong_key ;;
	tampered)     case_tampered ;;
	*)            fail "unknown test case: $test_case" ;;
esac
echo "PASS: $test_case on $release"
