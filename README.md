# openwrt-ziti-stack

Signed [OpenZiti](https://openziti.io) packages for OpenWrt 25.12, installable with a plain `apk add`.

The upstream [ziti-openwrt](https://github.com/openziti/ziti-openwrt) project publishes `opkg` packages for OpenWrt 23.05. This repository builds the same software for the `apk` package manager used since OpenWrt 25.12.

## Packages

| Package | Purpose | When to install |
|---|---|---|
| `ziti-edge-tunnel` | The tunneler, plus its boot guard and watchdog | Always |
| `llhttp9` | HTTP parser library | Pulled in automatically |
| `openwrt-ziti-gateway` | Routes LAN traffic into the tunnel | Only if LAN clients should use Ziti |
| `luci-app-ziti` | Web interface under Services > OpenZiti | Optional |

The device's role is decided by the service policies on your Ziti controller, not by the packages:

- **Exit point:** `ziti-edge-tunnel` and an identity with a Bind policy.
- **LAN gateway:** add `openwrt-ziti-gateway` and use an identity with a Dial policy.
- **Both:** the same packages, with an identity that has both policies. If the watchdog detects a dead exit in full-tunnel mode it stops the whole tunneler, which also stops this device's exit role.

## Supported systems

Only official OpenWrt firmware is supported. Vendor firmware has different kernels, libraries, and package managers.

| Architecture | OpenWrt | Built | Installed and started in a container |
|---|---|---|---|
| `aarch64_cortex-a53` | 25.12.0 to 25.12.6 | Yes | Yes, in an `aarch64_generic` image |

Devices tested on real hardware:

| Device | OpenWrt | Result |
|---|---|---|
| Cudy WR3000P v1 | 25.12.6 | Not yet tested |

Use the latest 25.12.x: older releases are available for existing installations, but newer ones carry security fixes. A matching architecture does not prove that a specific device works, because kernel modules and hardware offload differ between targets.

## Install

The official OpenWrt repositories must stay enabled, because they supply the dependencies. Paste this over SSH:

```sh
(
  set -e
  . /etc/openwrt_release
  ARCH=$(cat /etc/apk/arch)
  FEED=https://pipzic.github.io/openwrt-ziti-stack
  REPO="$FEED/$DISTRIB_RELEASE/$ARCH/packages.adb"
  uclient-fetch -q -O /dev/null "$REPO"          # stops here on an unsupported release or architecture
  uclient-fetch -q -O /tmp/openwrt-ziti-stack.pem "$FEED/openwrt-ziti-stack.pem"
  echo "a479efa32458cbd16fba98ed2b0dc2d921329312490729739a04f6531d56ceae  /tmp/openwrt-ziti-stack.pem" | sha256sum -c -
  mkdir -p /etc/apk/keys /etc/apk/repositories.d
  mv /tmp/openwrt-ziti-stack.pem /etc/apk/keys/
  echo "$REPO" > /etc/apk/repositories.d/openwrt-ziti-stack.list
  apk update
  apk add ziti-edge-tunnel                       # optional: openwrt-ziti-gateway luci-app-ziti
)
```

## Enroll an identity

Through the web interface (Services > OpenZiti > Identities), or on the command line:

```sh
ziti-edge-tunnel enroll --jwt /tmp/device.jwt --identity /etc/ziti/identities/device.json
chmod 600 /etc/ziti/identities/device.json
rm /tmp/device.jwt
/etc/init.d/ziti-edge-tunnel restart
```

## The gateway package

Installing `openwrt-ziti-gateway` does the following:

- creates a firewall zone on `ziti0` and a `lan -> ziti` forwarding, unless a compatible zone already exists;
- turns off software and hardware flow offload, which could let forwarded traffic bypass the tunnel. Routing throughput drops as a result;
- saves the original offload values in `/etc/config/openwrt_ziti_gateway`.

It does not touch `lan -> wan` forwarding or DNS. Removing the package deletes its own firewall sections and restores the offload values.

If `ziti.main.tunnel_mode` is set, the web interface manages the tunnel, and removing the package leaves the firewall unchanged. It prints the commands for removing the settings by hand. In `full` mode the web interface also removes `lan -> wan`, so LAN clients have no direct internet until you add it back.

If setup fails, `apk` reports the error and the previous firewall configuration is restored, but the package stays installed and is marked as broken. Fix the cause, then run:

```sh
apk fix openwrt-ziti-gateway
```

## After a system upgrade

`sysupgrade` replaces the installed packages. Whether the signing key and the feed list survive depends on how you upgrade. Run the install snippet again for the new release, then install the same optional packages. Identities and settings under `/etc` are kept by a normal keep-settings upgrade.

Attended Sysupgrade and `owut` do not carry packages from third-party feeds into the new image.

## Remove

```sh
apk del luci-app-ziti openwrt-ziti-gateway ziti-edge-tunnel
rm /etc/apk/repositories.d/openwrt-ziti-stack.list /etc/apk/keys/openwrt-ziti-stack.pem
```

## Differences from upstream

- Built for OpenWrt 25.12 and `apk`, at a pinned upstream commit.
- `ziti-edge-tunnel` 1.18.7, with a guard for libuv older than 1.50, because OpenWrt 25.12 ships 1.48.
- `ziti-edge-tunnel` depends on `curl`. The boot guard needs it, and without it the watchdog treats a healthy full tunnel as dead.
- The web interface's update check uses `apk`.
- `openwrt-ziti-gateway` is new.

The patches are in [`patches/`](patches/).

## Trust model

Each package index is signed with this project's key, and `apk` checks that signature and the package hashes it contains. The private key is used only by the signing job. The public key is in [`keys/`](keys/), and its SHA-256 is in the snippet above.

A valid signature only shows that this repository published the package. It does not show that the code is safe. Upstream sources are pinned by commit and hash, except for `ziti-sdk-c`, which the tunneler's build fetches by tag.

GitHub Actions builds every package from this repository with the OpenWrt SDK, verified against OpenWrt's signed checksums. See [the workflow](.github/workflows/build.yml).

## Maintenance

**Add an OpenWrt release:** add it to `RELEASES` in [`versions.env`](versions.env).

**Change a patch, the gateway, or a dependency:** bump `PACKAGE_RELEASE` in `versions.env`, otherwise `apk` will not offer the update.

**Build locally:** this needs Docker. The SDK runs only on x86-64, so other hosts use emulation.

```sh
docker build --platform linux/amd64 --tag openwrt-ziti-stack-builder:amd64 .
mkdir -p out
docker run --rm --platform linux/amd64 --user "$(id -u):$(id -g)" --env HOME=/tmp \
  --volume "$PWD/out:/out" openwrt-ziti-stack-builder:amd64 \
  /opt/openwrt-ziti-stack/scripts/build.sh 25.12.6
```

**Set up publishing in a fork:**

1. Create a signing key and replace the public key:
   ```sh
   openssl ecparam -name prime256v1 -genkey -noout -out signing-key.pem
   openssl ec -in signing-key.pem -pubout -out keys/openwrt-ziti-stack.pem
   ```
2. In the repository settings, set Pages > Source to GitHub Actions.
3. Add the contents of `signing-key.pem` as the secret `APK_SIGNING_KEY` in the `github-pages` environment.
4. Update the feed URL and the key's SHA-256 in this README.

## License

[Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for third-party software.
