# Changelog

Package versions are `<ziti-edge-tunnel version>-r<PACKAGE_RELEASE>`, for example `1.18.7-r22`. The first part is the version of the upstream tunneler. The `r` number goes up with every change to the packages, because `apk` upgrades only to a higher version.

Releases r6 to r21 were test builds and were not published. r22 is the first published release after r5. Each entry lists what changed since the build before it.

## 1.18.7-r23 - 2026-11-07

The package preserves the router's DNS server settings and no longer edits `/etc/hosts`.

Upgrading does not revert changes made by earlier releases. Before upgrading from r22, run `apk del luci-app-ziti ziti-edge-tunnel`. The r22 removal script restores `noresolv`, removes the DNS servers it added, and removes its block from `/etc/hosts`. Identities and settings are preserved.

### Added

- `source_zones` ("Source zones") selects the firewall zones allowed to forward traffic to the tunnel. The default is `lan`; guest networks in separate zones can also be selected. The watchdog manages forwardings named `ziti_fwd_<zone>` for existing zones, removes managed forwardings for deselected zones, and preserves user-created forwardings.
- With **Block services on failure** enabled, an unexpected tunnel process exit keeps services blocked until procd restarts the tunnel and health checks pass. Service subnets are cached in `/etc/ziti/service-prefixes`, alongside cached service names, because the process exit removes the tunnel's routes. Previously, service traffic used normal routes until the restart. Selecting Stop removes the blocking. The status page now reports the process exit and pending procd restart.
- Enroll, update checks, and upgrades run in the background while LuCI polls for the result. LuCI's 20-second request timeout previously caused slow upgrades to appear to fail while they continued, allowing another click to start a second operation. Further operations are now rejected while one is running.
- The watchdog writes DNS forwarding rules for controller and router names to `ziti-fabric.conf` in dnsmasq's configuration directory, using the router's existing DNS configuration. This prevents broad service intercepts, such as `*.org`, from resolving OpenZiti endpoints to tunnel addresses and routing the tunnel's own connections through itself. A test with a domain-wide service intercept reproduced this routing loop. Existing domain rules, such as `/example.org/192.168.1.53`, determine the upstream servers used. The watchdog updates the file and restarts dnsmasq only when the rules change.

### Changed

- DNS queries for names outside service intercepts now use the router's configured DNS servers, including those supplied by the provider, set on the WAN interface, or listed under Forwards. Previously, the package enabled `noresolv` and added `1.1.1.1` and `8.8.8.8`, bypassing the provider's servers. The OpenZiti resolver now refuses queries outside service intercepts so dnsmasq can try the configured servers.
- `198.18.0.2` goes to the top of the dnsmasq server list while the tunnel is healthy. Your own entries keep their order and no longer come before OpenZiti.
- The watchdog checks every 5 seconds instead of 10, with a startup delay of 15 seconds instead of 20. The first restart attempt for a disconnected or unresponsive tunnel is scheduled after 30 seconds instead of 60; subsequent delays are 120, 600, and 1800 seconds. Internet and DNS check timeouts are reduced to 3 seconds from 4 and 5 seconds respectively; measured responses took well under a second. The connection timeout remains 12 seconds because OpenZiti reports failed connections after about 10 seconds. The tunnel status timeout remains 4 seconds; a failed request or timeout enables bypass immediately.
- Probe connection attempts now run in parallel. A successful connection ends the check; otherwise, matching failure messages from OpenZiti can satisfy an automatic check. In a test with OpenZiti connectivity cut, bypass began after 39 seconds instead of 84 seconds. A normal check now starts up to three connections rather than usually one.
- Update checks consider only versions from the project feed. If another repository has a newer version than the project feed, it is shown but no upgrade is offered, because apk would select that version instead.
- Tunnel status and DNS requests return as soon as they finish, removing a one-second wait per request. A healthy check now takes a fraction of a second instead of about 3 seconds. A service that accepts a TCP connection but sends no data no longer holds the probe open for the full 12-second timeout.
- The watchdog's log messages use plain terms that are easy to search: "bypass on", "bypass off", "Ziti DNS added to dnsmasq".
- The README updates only these packages instead of running `apk upgrade`, which upgrades every package on the router.
- On the settings page, "Internet and exit" is renamed to "Internet check", and the DNS section is removed. Settings apply without restarting the tunnel.

### Fixed

- Enroll left the token file in `/etc/ziti/.jwt-stage` after each attempt because the exit cleanup referenced a function-local variable that was no longer set. Tokens are now staged in `/var/run/ziti-jwt` in RAM, keeping any file left by a terminated rpcd call off flash and out of persistent backups.
- When traffic went around the tunnel or came back, the status showed the old state for a few seconds while dnsmasq restarted. The watchdog now writes the state first.
- With **Block services on failure** enabled, blocking routes also rejected the watchdog's own probes. A tunnel with only IP-based services could therefore remain in bypass after recovery. Probes now skip the bypass table.
- During bypass, the watchdog flushed and rebuilt the bypass table on every check, briefly allowing traffic to use the tunnel's routes. The table is now rebuilt only when the source routes, cached service prefixes, or blocking setting change.
- If `strictorder` was turned off after installation, the watchdog restarted dnsmasq on every check without turning it back on. It now sets it again.
- DNS server selection for controller and router names now respects more specific forwarding rules that use `#` or specify no server, matches `*.example.org`, and compares names without regard to case.
- Bypass detection now checks both rule priority and routing table for IPv4 and IPv6. Previously, an unrelated rule at the same priority could be mistaken for bypass, and an IPv6 bypass rule left without its IPv4 counterpart was not removed.
- Enroll ignored the tunneler's exit code, and two enrollments in the same second got the same file name.
- Update checks now select the newest available version instead of the first version listed by `apk`, which could be older than the installed version.
- "Override internet check addresses" accepted IPv6 addresses, which the check cannot use. It now takes IPv4 only.
- An identity name with a control character broke the identity list.
- Two backend error messages are now translated in the Russian interface.

### Removed

- Controller address entries in `/etc/hosts` and the `refresh-hosts` command. The command queried dnsmasq, which returned the same cached addresses, preventing discovery of a controller whose address changed while the router was off. The tunneler resolves controller and router names when connecting.
- `dns_upstream` ("Override upstream DNS server") and `dns_fallback_servers` ("Override fallback DNS servers"). These selected DNS servers for names outside service intercepts while the tunnel was healthy or unavailable. The router's DNS configuration now controls both cases.
- The exit address check: `verify_expect_ip`, `verify_url` and `verify_timeout`. It queried one address through one service from the router and depended on a third-party public IP service. Custom targets under "Check specific resources" can check exit connectivity. Bypass did not address cases where the exit worked but had an unexpected public IP address.
- Upgrade-time cleanup of settings, DNS changes, and the `/etc/hosts` block left by earlier releases. The package no longer migrates these changes; remove the older release before installing this one.
- An empty translation template that pointed to a script that does not exist.

## 1.18.7-r22 - 2026-11-07

### Added

- The README now says that the host in `verify_url` must be part of a service of your identity. The exit address check connects through the tunnel, so any other host makes the check fail, and traffic then goes around the tunnel.
- The README also warns that the router sends that host into the tunnel for every device on your network, not only for the check. A dynamic DNS client that uses the same host to find your public address would get the exit address instead, and might publish it. Do not pick a host that anything on your network relies on.
- This changelog.

### Changed

- A token that has expired, was already used, or was revoked now gives one `Enroll` error that tells you to create a new token on the controller. The controller often reports an expired token as invalid, so the three cases cannot be told apart.
- `Enroll` errors now start with "Enrollment failed". They used to start with "connection error" in Russian, which was misleading, because a bad token has nothing to do with the connection.
- English and Russian texts are reworded across the interface to read like OpenWrt's own LuCI, and to mean the same in both languages. For example, "Select a JWT file." replaces "Please select a JWT file.", and "restart pauses" became "restart delays".

## 1.18.7-r21 - 2026-11-02

A small text fix. The build also passed the full release test chain and was installed on a router.

### Fixed

- On the Russian settings page, the heading of the restart group read "Перезапустить", which is a command. The heading and the `Restart` button on the Status page shared one string. The heading is now `Restarts` in English and "Перезапуск" in Russian, and the button keeps its own text.

## 1.18.7-r20 - 2026-11-02

### Added

- `Enroll` errors name the cause instead of showing the tunneler's raw line, such as `JWT not accepted by controller(-3)`. You now see a message for an unusable token, a file that is not a token, or a controller that cannot be reached. Any other failure shows the last line of the tunneler's output.
- The groups on the settings page have headings in the colour of the LuCI theme, with a line under them: Checks, Timeouts, Restart, Internet and exit, Bypass. A flat list of about twenty settings was hard to scan.

### Changed

- The watchdog checks a subnet through its first address, such as `128.0.0.1` for `128.0.0.0/1`, so all service addresses count the same. A random address would not do: a connection to a random host every ten seconds looks like a port scan from your exit address. A failed connection to the first address still proves the fabric works, because the fabric reports the failure.
- `watchdog_public_probes` is renamed `watchdog_wan_probes`. It now only checks the internet connection, which tells a lost internet connection from a fabric failure.
- `watchdog_timeout` cannot be set below 11 seconds, because the fabric reports a failed connection after about 10 seconds. The default stays 12.

### Removed

- `watchdog_narrow_prefix`. It decided which subnets counted as "wide" and were checked through public addresses. The split is not needed now that every address is treated the same.

## 1.18.7-r19 - 2026-11-02

Fixes found by running r18 on a router.

### Fixed

- A service without terminators passed the first check and then failed the next ones, so traffic went around the tunnel although the fabric was answering. The tunnel logs the same "no terminators" reason word for word, and the watchdog took the repeat for an old message. It now compares the whole log line, including its time.
- With the exit address check on, the check failed while traffic was going around the tunnel, because it could not look up the name of its service. It now asks the Ziti resolver directly.
- Setting values lost letters, for example in `verify_url`, so the exit address check used a broken address. BusyBox `tr -d '[:space:]'` does not know the class and deleted the letters `s`, `p`, `a`, `c` and `e`. The call is gone.

## 1.18.7-r18 - 2026-11-02

### Added

- Each check picks random addresses from all your services, a new choice every time, instead of taking the first three the tunnel lists. `watchdog_probe_count` sets how many (default 3). The first three could all belong to one dead service, which would send all traffic around the tunnel.
- The watchdog keeps the list of addresses between checks and rebuilds it only when the services, the tunnel's routes or the settings change. Reading a large list is slow: with 500 addresses and 100 names it takes about 17 seconds once, and a check then takes about 0.07 seconds.
- Two settings decide how subnets wider than a limit are checked: `watchdog_narrow_prefix` (default 24) and `watchdog_public_probes`. A subnet with a shorter prefix counts as wide, and the watchdog checks the public addresses that fall inside it instead.
- `/usr/libexec/ziti-boot-guard probes` shows how many addresses the watchdog knows and which ones the next check would pick.
- Settings for the restart delays (`watchdog_restart_delays`), the timeouts of the tunnel's answer, the internet check and DNS, the exit address service (`verify_url`, `verify_timeout`), and the bypass table and rule priority (`bypass_table`, `bypass_priority`). A bypass that is already running keeps its old table and priority, so a changed setting cannot strand its routing rule.
- The settings page folds the watchdog parameters into the list "Additional watchdog settings". The list opens by itself while any of its settings is changed, so a change is never hidden. Every field has a format hint.
- The README describes how the watchdog decides, with a flowchart and a diagram of how the parts fit together. It also lists every setting, explains why the DNS range is overridden, and lists what the package adds, changes and leaves alone on the router.

### Changed

- A connection that the target refuses, or a service that has no terminators, now counts as an answer from the fabric. A dead service alone no longer sends traffic around the tunnel. The fabric did carry the request, and the watchdog checks the fabric, not each service. The cost is that traffic of a dead service fails until the service returns.
- `watchdog_probes` ("Check specific resources") now lists resources that must really answer. When it is set, the watchdog checks only these addresses, and an answer of "refused" or "no terminators" does not count. Use it for a resource that must work, such as the exit of a full tunnel.

### Fixed

- An upgrade of the package wiped a changed `watchdog_timeout`, because the cleanup meant for old releases ran on every upgrade. It now runs only on a configuration that still has `tunnel_mode`.
- The block of controller addresses stayed in `/etc/hosts` after `apk del`. The package now removes it, and creates it again on installation.

## 1.18.7-r17 - 2026-11-02

### Fixed

- On the Status page, the `Start`, `Stop` and `Restart` buttons showed as the text `[object HTMLButtonElement]`. LuCI turns a list inside a list into text, so the page now builds a flat list.
- After `Stop` or `Restart`, the Status page still showed the old state, such as "Stopped" with "Working". A check that was already running overwrote the state file. The page now works out the state when it reads it: a manual stop and the startup delay come first.

## 1.18.7-r16 - 2026-11-02

A test build made while the full release test chain ran. It has one fix.

### Fixed

- After the tunnel process died on its own, the Status page showed "Starting" for as long as the tunnel stayed down. It now shows "Starting" only during the startup delay, and "Stopped" after that.

## 1.18.7-r15 - 2026-11-02

A test build made after the first live tests of the new watchdog.

### Changed

- When the package is upgraded from an older release, it removes the defaults that release had written to `/etc/config/ziti`, such as a short `watchdog_timeout`. The old timeout was too short for the new check, which waits for the fabric to answer.

### Fixed

- When the tunnel lost its connection to the controller, the Status page said "No services available", and the watchdog did not restart the tunnel. A tunnel that is not logged in lists no services, and the watchdog checked for services first. It now checks the connection first and reports "No connection", and the tunnel restarts after a pause. "No services" is left for a tunnel that is connected but has no services, or has every identity turned off.

## 1.18.7-r14 - 2026-11-02

A redesign of the watchdog, the modes and the settings page. The goal is reliable remote access to routers without open ports, whatever the provider or the IP address does. The old watchdog stopped the tunnel on a failure and never started it again, and that also cut remote access to the router.

### Added

- A new watchdog, started by the `ziti-guard` service and run by `/usr/libexec/ziti-boot-guard`. It checks the OpenZiti fabric by opening TCP connections to service addresses through the tunnel. It also tells a lost internet connection from a fabric failure, so it does not restart the tunnel when the internet is down.
- While the tunnel is broken, it keeps running and keeps trying to reconnect, and traffic goes around it. The watchdog keeps a copy of the main routing table without the routes of `ziti0`, and switches to it with one routing rule. A route that the tunnel adds later stays out of the way. When the connection returns, the watchdog removes the rule.
- An optional setting, `block_on_failure` ("Block services on failure"), blocks the addresses and names of the services instead of letting them go directly. It is off by default.
- The Status page shows why the tunnel is in its state: working, starting, stopped, not checked because the watchdog is off, no identities enrolled, no services available, no internet connection, no connection to the controller or the OpenZiti routers, connected but services do not respond, and the tunnel does not respond.
- The watchdog restarts the tunnel only when it does not respond, or has no connection to the controller while the internet works. The pauses grow: 1 minute, then 5, 15, and 30 minutes from then on. A tunnel that you stopped yourself stays stopped. After a reboot, the autostart button decides.
- dnsmasq asks OpenZiti first and falls back to other servers while the tunnel is broken. The package sets `noresolv` and `strictorder` to make the order strict, and restores your values on `apk del`. The OpenZiti resolver is listed only while the tunnel is healthy, because `strictorder` waits for a server that stays silent.
- An optional check that traffic leaves from the expected public address (`verify_expect_ip`).
- The controller's addresses are kept in `/etc/hosts`, so the tunnel reaches the controller without asking its own resolver, even while DNS is broken or the controller's name falls under a service.
- The firewall zone `ziti` and the forwarding from `lan` to `ziti` are created on installation. Forwarding from `lan` to `wan` and flow offload stay as they are. The removed `openwrt-ziti-gateway` package did this job, and it also turned offload off.
- Each identity has an `Enabled` or `Disabled` button in the table on the Identities page. The choice survives a reboot. The status of an identity is real: it is "Active" only when the identity is signed in and connected to a router, and otherwise "No connection", "Tunnel stopped" or "Disabled".
- Each setting with a default has an "Override" checkbox. The hint shows the default value, and the field appears when you tick the box. This replaces the `Show advanced settings` checkboxes. The default is now always visible, and a field appears only when you override it.

### Changed

- One tunnel serves all identities, and the services of the identities decide what enters the tunnel. The `full` and `split` modes did not decide that: they only chose an identity and removed forwarding from `lan` to `wan`. A failure is now handled the same way in every case.
- Service names get addresses from the fixed range `198.18.0.0/16`. dnsmasq rebind protection drops the default range `100.64.0.0/10`, so service names stayed unresolved for the devices behind the router unless you turned the protection off. Answers from `198.18.0.0/16` pass it.
- The settings apply without restarting the tunnel, except `dns_upstream`. Turning an identity on or off and removing one need no restart either. `Enroll` still restarts the tunnel, because the tunneler's `add` command does not work.
- `Start at boot` is a button in the style of OpenWrt: green "Enabled" or red "Disabled". It only decides whether the tunnel starts at boot. `Start` works whether or not it is enabled, which the old `Enabled` setting prevented. The old setting `enabled` is gone.
- The log levels read `Error`, `Warning`, `Info`, `Debug`, `Verbose` and `Trace`, not in capital letters. The values in `/etc/config/ziti` are the same as before.
- The Russian texts follow the wording of OpenWrt's own LuCI translation. `OpenZiti` is used in headings and the menu, and `Ziti` in running text.
- An upgrade from an older release cleans up after it. It removes the retired settings, restores the dnsmasq values the older DNS mode had saved, and turns identities back on that the old modes had switched off by renaming their files.

### Removed

- The `Tunnel Mode` page, the `full` and `split` modes, and the settings `tunnel_mode`, `full_identity` and `split_identity`.
- The `Send all DNS through Ziti first` setting (`dns_failover`): DNS always goes through OpenZiti first now.
- The Ziti resolver address setting and the list of Ziti domains. The address range is fixed, and the list is not needed when all DNS goes through OpenZiti.
- The cache of identity names: the tunnel's own configuration has them.

## 1.18.7-r13 - 2026-11-02

Never finished. The build was stopped before it completed, and its changes first shipped in r14.

## 1.18.7-r12 - 2026-11-02

### Changed

- About 40 Russian texts are rewritten in plain language, because the first translation was too literal. For example, the hint for the log level now begins "Уровень логирования ziti-edge-tunnel". Hints for checkboxes read "Когда включено… Когда выключено…". Hints for empty fields read "Если поле пустое: …". Several field names are reworded.

## 1.18.7-r11 - 2026-11-02

### Changed

- `Enroll`, `Resilience watchdog` and `watchdog` stay in English in the Russian interface, as names, not words to translate. The Russian word "сторож" is replaced by `watchdog` in related texts, so the term is the same everywhere.

## 1.18.7-r10 - 2026-11-02

### Added

- A Russian translation inside `luci-app-ziti`, with all 117 strings of the interface: the menu, hints and errors. LuCI shows it when the interface language is Russian. The build compiles it with `po2lmo`, which it takes from the LuCI sources pinned in the SDK, without building LuCI itself. The rootfs test checks that the translation is installed. It is part of the package, not a separate `luci-i18n-*` package, because one language of 13 KB does not justify a second package.

### Changed

- The `Enroll` button on the Identities page sits next to the file chooser. The extra text under the chooser is gone.

## 1.18.7-r9 - 2026-11-01

### Changed

- `Enroll` needs only the `.jwt` file. The name of the identity comes from the controller, as in the regular Ziti clients. The token does not contain it, so the tunnel reports it after it loads the identity. The file is saved as `identity-<time>.json`, and the name is cached, so it shows even while the tunnel is stopped.
- The Status page shows the service state, the version, an `Enabled` checkbox and the control buttons. `Start` and `Restart` do nothing while the box is unticked. The change applies at once, without `Save & Apply`.
- The Identities page lists name, controller and status, with a remove button. Below it are the file chooser and the `Enroll` button.
- The Tunnel Mode page no longer has the "Loaded identity" row. The drop-down lists show the names from the controller.

### Removed

- The `Enabled` setting on the settings page. It moved to the Status page.
- The "Guard state" row and its state file. Nothing read them any more.

### Fixed

- After `Enroll`, the page showed the name of the file until the next refresh, because the controller's name arrives a moment later. The page now waits up to 10 seconds for it.

## 1.18.7-r8 - 2026-11-01

A test build between r7 and r9. Its changes are listed under r9.

## 1.18.7-r7 - 2026-11-01

### Changed

- Rarely used settings are hidden behind `Show advanced settings`. The checkbox stores nothing, and hidden values are kept when you save.
- Every field says what happens when it is empty, and lists the default value.
- Adding or removing an identity restarts the tunnel, so the change applies at once.
- The documentation link points to this project's README.
- The headings and blocks on the four pages look the same.

### Removed

- The `verify` command and the settings `max_boot_failures`, `verify_tries` and `verify_interval`. Nothing ever ran the `verify` command, so the failure counter never turned the service off, and the settings had no effect.
- Dead leftovers: the build stamp on the pages, empty stubs and extra entries in the ACL, a `luci.mk` branch in the `Makefile`, and two outdated package READMEs that still described `opkg` and version 1.15.1.

### Fixed

- Log level `VERBOSE` worked as `INFO`.
- The check interval, the failure count and the timeout accepted 0. That gave a loop with no pause, or a check with no timeout. The minimum is now 1.
- The version was shown as `v1.18.7.v1.18.7`.
- Removing an identity showed no errors, left its `.disabled` file, and kept the tunnel on the old identity. It now cleans up and restarts the tunnel, and also clears the mode choice that pointed at the identity.
- Several hints promised things that did not happen. The probe targets field said `host:port` but accepts no port. The `Startup grace` pause happens only when the watchdog starts, not on every tunnel restart. The `Tunnel Mode` hint spoke of a highlighted button, but the active button is grey. The hints now match the code.

## 1.18.7-r6 - 2026-11-01

### Added

- A DNS setting, `Send all DNS through Ziti first` (`dns_failover`), off by default. While the tunnel is healthy, dnsmasq asks OpenZiti first, so service names work without a list of Ziti domains. When the tunnel stops, the watchdog takes OpenZiti out of the list, and names resolve through the fallback servers `1.1.1.1` and `8.8.8.8` within 12 seconds (32 seconds if the tunnel hangs). The mode turns off dnsmasq rebind protection for the whole router, because that protection drops the `100.64.x.x` addresses of the tunnel. The hint and the README say so.
- The settings page shows default values that were hidden in the code: probe addresses, intervals and the Ziti DNS address.

### Changed

- `llhttp`, `stc`, `luci-app-ziti` and `ziti-edge-tunnel` live in `packages/`, derived from ziti-openwrt `f54a5d76`, instead of being cloned and patched at build time. The UI and watchdog patch had grown to 490 lines, and every new change had to sit on top of it. Now one repository holds the code, and `git diff` shows every change. Fixes from upstream no longer arrive by themselves.
- `ZET DNS upstream` defaults to `1.1.1.1`, so the fallback works after installation without further setup. The value `none` makes the tunnel refuse names it does not know.
- One enable checkbox instead of two: `Start at boot` is gone, and `Enabled` stays. The two did almost the same, and it was unclear which one won.

### Removed

- `ZITI_OPENWRT_REV` and the ziti-openwrt patches. Only the patch for libuv older than 1.50 stays, because it applies to code that the build downloads.
- The `autostart` field from the status of the service.

## 1.18.7-r5 - 2026-11-01

The first release.

### Added

- A signed apk feed on GitHub Pages with `ziti-edge-tunnel` 1.18.7 and `luci-app-ziti` for OpenWrt 25.12.0 to 25.12.6, built for `aarch64_cortex-a53` (`mediatek/filogic`). `llhttp9` comes along as a dependency.
- The packages are built from ziti-openwrt `f54a5d76` with three patches: a guard for libuv older than 1.50, because OpenWrt 25.12 ships 1.48; a `curl` dependency, because the boot guard uses it and otherwise counts a healthy full tunnel as dead; and an update check in the web interface that uses `apk` instead of `opkg`. The OpenZiti C SDK, which the build downloads, gets a patch for the same libuv problem.
- Every OpenWrt release is built, signed and tested before publishing. The tests install the packages in an OpenWrt container and check that `apk` refuses a wrong key and a tampered package. GitHub Actions runs the build, the signing and the tests.
- `install.sh` adds the feed key, after it checks its SHA-256, and the feed list, then installs `ziti-edge-tunnel`. You can name other packages as arguments.
- The web interface under Services > OpenZiti, with the pages Status, Identities, Tunnel Mode and Settings.

### Removed

- The `openwrt-ziti-gateway` package, which was in the first commit of this release. `ziti-edge-tunnel` does its job from r14.
