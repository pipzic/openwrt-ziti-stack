# Host tools for the OpenWrt SDK, which brings its own cross-toolchain.
# The SDK only runs on linux/amd64, so builds use --platform linux/amd64.
FROM debian:12-slim@sha256:abd67ffcfa541b485a3dff59865ab629aa048a6c613e639d36e7456b0b229241

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        bash \
        build-essential \
        bison \
        ca-certificates \
        curl \
        file \
        flex \
        gawk \
        git \
        jq \
        libncurses-dev \
        libssl-dev \
        openssl \
        patch \
        python3 \
        python3-distutils \
        rsync \
        signify-openbsd \
        unzip \
        wget \
        xz-utils \
        zstd \
    && rm -rf /var/lib/apt/lists/*

COPY versions.env /opt/openwrt-ziti-stack/versions.env
COPY keys /opt/openwrt-ziti-stack/keys
COPY patches /opt/openwrt-ziti-stack/patches
COPY scripts /opt/openwrt-ziti-stack/scripts

# The SDK refuses to build as root.
RUN chmod -R a+rX /opt/openwrt-ziti-stack \
    && useradd --create-home --shell /usr/sbin/nologin --uid 1000 builder
USER builder
