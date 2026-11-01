#!/usr/bin/env bash
# Check the built packages and sign one index per release directory.
# Only this repository's scripts and a verified SDK run here. Nothing from the
# build artifacts is executed.
#   APK_SIGNING_KEY=<pem> sign-feed.sh <feed-dir>
set -euo pipefail

feed="${1:?usage: sign-feed.sh <feed-dir>}"
[[ -n "${APK_SIGNING_KEY:-}" ]] || { echo 'APK_SIGNING_KEY is not set' >&2; exit 2; }
# shellcheck source=scripts/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

PACKAGES='llhttp9 luci-app-ziti ziti-edge-tunnel'
PUBLIC_KEY="$ROOT/keys/openwrt-ziti-stack.pem"

WORK_DIR="$(mktemp -d /tmp/openwrt-ziti-sign.XXXXXX)"
chmod 0700 "$WORK_DIR"
trap 'rm -rf "$WORK_DIR"' EXIT
KEY_FILE="$WORK_DIR/signing-key.pem"
(umask 077; printf '%s\n' "$APK_SIGNING_KEY" > "$KEY_FILE")
openssl ec -in "$KEY_FILE" -pubout 2>/dev/null | cmp -s - "$PUBLIC_KEY" \
  || die "APK_SIGNING_KEY does not match $PUBLIC_KEY"

# The apk wrapper in the SDK needs its loader and libraries, so unpack it whole.
latest="${RELEASES##* }"
SDK_ARCHIVE="$(verified_fetch "$latest" "$TARGET" 'openwrt-sdk-[^ ]*\.Linux-x86_64\.tar\.zst' "$WORK_DIR/download")"
SDK_DIR="$(unpack_sdk "$SDK_ARCHIVE" "$WORK_DIR")"
APK="$SDK_DIR/staging_dir/host/bin/apk"

# Only the expected release directories may exist.
expected_dirs="$(printf "$feed/%s\n" $RELEASES | sort)"
actual_dirs="$(find "$feed" -mindepth 1 -maxdepth 1 | sort)"
[[ "$actual_dirs" == "$expected_dirs" ]] \
  || die "unexpected feed layout: $(printf '%s ' $actual_dirs)"

for release in $RELEASES; do
  dir="$feed/$release/$ARCH"
  [[ "$(find "$feed/$release" -mindepth 1 -maxdepth 1)" == "$dir" ]] || die "unexpected content in $feed/$release"
  [[ "$(find "$dir" -mindepth 1 ! -name '*.apk' | wc -l)" == 0 ]] || die "non-package files in $dir"
  [[ "$(find "$dir" -mindepth 1 -name '*.apk' | wc -l)" == 3 ]] || die "expected 3 packages in $dir"

  # --keys-dir is relative to --root. An empty directory proves nothing is trusted here.
  mkdir -p "$WORK_DIR/empty/keys"
  (
    cd "$dir"
    "$APK" mkndx --root "$WORK_DIR/empty" --keys-dir keys --allow-untrusted \
      --sign-key "$KEY_FILE" --output packages.adb ./*.apk
  )

  index="$("$APK" adbdump --format json "$dir/packages.adb")"
  names="$(jq -r '.packages[].name' <<< "$index" | sort | xargs)"
  [[ "$names" == "$PACKAGES" ]] || die "unexpected packages in $dir: $names"
  arch_list="$(jq -r '.packages[].arch' <<< "$index" | sort -u | xargs)"
  [[ "$arch_list" == "$ARCH noarch" ]] || die "unexpected architectures in $dir: $arch_list"
done

rm -f "$KEY_FILE"
cp "$PUBLIC_KEY" "$feed/openwrt-ziti-stack.pem"
printf 'signed %s\n' "$feed"
