# shellcheck shell=bash
# Shared helpers for the build and signing scripts. Source, do not execute.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOWNLOADS="https://downloads.openwrt.org/releases"

# shellcheck source=/dev/null
source "$ROOT/versions.env"

die() {
  printf '%s\n' "$*" >&2
  exit 1
}

fetch() {
  curl --fail --silent --show-error --location --retry 3 --output "$2" "$1"
}

# Download one file listed in a release's signed sha256sums and verify it.
# Prints the path of the verified file.
#   verified_fetch <release> <target> <filename-regex> <destination-dir>
verified_fetch() {
  local release="$1" target="$2" pattern="$3" dest="$4"
  local base="$DOWNLOADS/$release/targets/$target"
  local sums matches sum name actual
  sums="$(mktemp -d)"

  fetch "$base/sha256sums" "$sums/sha256sums"
  fetch "$base/sha256sums.sig" "$sums/sha256sums.sig"
  signify-openbsd -V -q -p "$ROOT/keys/openwrt-usign.pub" \
    -x "$sums/sha256sums.sig" -m "$sums/sha256sums" >&2 \
    || die "bad signature on $base/sha256sums"

  # Lines look like "<sha256> *<filename>".
  matches="$(sed -n 's/^\([0-9a-f]\{64\}\) \*\(.*\)$/\1 \2/p' "$sums/sha256sums" \
    | PATTERN="^${pattern}\$" awk '$2 ~ ENVIRON["PATTERN"]')"
  [[ "$(printf '%s' "$matches" | grep -c '^')" == 1 ]] \
    || die "expected one match for $pattern in $base/sha256sums, got: ${matches:-none}"
  read -r sum name <<< "$matches"
  [[ "$name" =~ ^[A-Za-z0-9._-]+$ ]] || die "unsafe file name: $name"

  mkdir -p "$dest"
  [[ -f "$dest/$name" ]] || fetch "$base/$name" "$dest/$name"
  actual="$(sha256sum "$dest/$name" | awk '{print $1}')"
  [[ "$actual" == "$sum" ]] || die "sha256 mismatch for $name"
  rm -rf "$sums"
  printf '%s\n' "$dest/$name"
}

# Unpack a verified SDK archive and print its directory.
#   unpack_sdk <archive> <destination-dir>
unpack_sdk() {
  tar --use-compress-program=unzstd -xf "$1" -C "$2"
  local sdk
  sdk="$(find "$2" -mindepth 1 -maxdepth 1 -type d -name 'openwrt-sdk-*' -print -quit)"
  [[ -n "$sdk" && -x "$sdk/scripts/feeds" ]] || die "unexpected SDK layout in $1"
  printf '%s\n' "$sdk"
}
