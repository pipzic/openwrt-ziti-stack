# SPDX-License-Identifier: Apache-2.0

include $(TOPDIR)/rules.mk

PKG_NAME:=openwrt-ziti-gateway
PKG_VERSION:=1.0.0
PKG_RELEASE:=1

PKG_MAINTAINER:=openwrt-ziti-stack contributors
PKG_LICENSE:=Apache-2.0

include $(INCLUDE_DIR)/package.mk

define Package/openwrt-ziti-gateway
  SECTION:=net
  CATEGORY:=Network
  SUBMENU:=VPN
  TITLE:=Route LAN traffic into the OpenZiti tunnel
  URL:=https://github.com/pipzic/openwrt-ziti-stack
  DEPENDS:=+ziti-edge-tunnel
  # Runtime only: the SDK must not compile the firewall.
  EXTRA_DEPENDS:=firewall4 (>=0)
  PKGARCH:=all
endef

define Package/openwrt-ziti-gateway/description
  Firewall zone for ziti0, lan to ziti forwarding, and flow offload turned off
  so forwarded traffic cannot bypass the tunnel. Not needed on a device that is
  only an exit point.
endef

define Build/Compile
endef

define Package/openwrt-ziti-gateway/install
	$(INSTALL_DIR) $(1)/usr/libexec
	$(INSTALL_BIN) ./files/usr/libexec/openwrt-ziti-gateway $(1)/usr/libexec/openwrt-ziti-gateway
endef

# The last command's status is the script's status, so apk reports a failed setup.
define Package/openwrt-ziti-gateway/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0
/usr/libexec/openwrt-ziti-gateway enable
endef

define Package/openwrt-ziti-gateway/prerm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0
/usr/libexec/openwrt-ziti-gateway disable
endef

$(eval $(call BuildPackage,openwrt-ziti-gateway))
