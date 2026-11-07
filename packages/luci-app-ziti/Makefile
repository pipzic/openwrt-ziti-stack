# SPDX-License-Identifier: Apache-2.0
#
# luci-app-ziti -- LuCI frontend for managing OpenZiti on OpenWRT.
#
include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-ziti
PKG_VERSION:=0.1.0
PKG_RELEASE:=3

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=openwrt-ziti-stack contributors

LUCI_TITLE:=LuCI support for OpenZiti (ziti-edge-tunnel)
LUCI_DEPENDS:=+ziti-edge-tunnel
LUCI_PKGARCH:=all

PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)

include $(INCLUDE_DIR)/package.mk

define Package/$(PKG_NAME)
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=$(LUCI_TITLE)
  DEPENDS:=$(LUCI_DEPENDS)
  # Runtime only: the view files need no LuCI build, so the SDK must not compile it.
  EXTRA_DEPENDS:=luci-base (>=0)
  PKGARCH:=$(LUCI_PKGARCH)
  URL:=https://openziti.io
endef

define Package/$(PKG_NAME)/description
  LuCI web UI for managing OpenZiti identities, enrollment via JWT, and the
  ziti-edge-tunnel service on OpenWRT.
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
endef

define Build/Configure
endef

# PO2LMO is passed in by scripts/build.sh, built from the SDK's LuCI feed.
define Build/Compile
	$(PO2LMO) ./po/ru/ziti.po $(PKG_BUILD_DIR)/ziti.ru.lmo
endef

define Package/$(PKG_NAME)/install
	# htdocs/ -> /www/
	if [ -d ./htdocs ]; then \
		$(INSTALL_DIR) $(1)/www ; \
		$(CP) -r ./htdocs/* $(1)/www/ ; \
	fi
	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/i18n
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/ziti.ru.lmo $(1)/usr/lib/lua/luci/i18n/ziti.ru.lmo
	# root/ -> /
	if [ -d ./root ]; then \
		$(CP) -r ./root/. $(1)/ ; \
		chmod 0755 $(1)/usr/libexec/rpcd/ziti ; \
	fi
endef

# rpcd only scans its plugin directory at startup; SIGHUP makes it load the new backend.
define Package/$(PKG_NAME)/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0
rm -rf /tmp/luci-modulecache
killall -HUP rpcd 2>/dev/null
exit 0
endef

$(eval $(call BuildPackage,$(PKG_NAME)))
