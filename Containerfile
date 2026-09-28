FROM docker.io/library/node:26.10.0-trixie@sha256:a723b54c35a76e947095a20a67d39585bb09c862e6b1adeb8a9f518f95e34fb0 AS pins
ARG TARGETARCH
ARG ZIG_VERSION=0.16.0
RUN apt-get update \
 && apt-get install -y --no-install-recommends zstd \
 && rm -rf /var/lib/apt/lists/*
RUN set -eu; \
    case "${TARGETARCH:-$(dpkg --print-architecture)}" in \
      amd64) zig_arch=x86_64; zig_sha256=70e49664a74374b48b51e6f3fdfbf437f6395d42509050588bd49abe52ba3d00 ;; \
      arm64) zig_arch=aarch64; zig_sha256=ea4b09bfb22ec6f6c6ceac57ab63efb6b46e17ab08d21f69f3a48b38e1534f17 ;; \
      *) echo "no pinned Zig for ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    tarball="zig-${zig_arch}-linux-${ZIG_VERSION}.tar.xz"; \
    curl -fsSLo "/tmp/${tarball}" "https://ziglang.org/download/${ZIG_VERSION}/${tarball}"; \
    echo "${zig_sha256}  /tmp/${tarball}" | sha256sum -c -; \
    mkdir /opt/zig; \
    tar -xJf "/tmp/${tarball}" -C /opt/zig --strip-components=1; \
    rm "/tmp/${tarball}"; \
    ln -s /opt/zig/zig /usr/local/bin/zig; \
    zig version
WORKDIR /src
COPY engines/pins.json engines/
COPY vendor/avalanche-web-abi1/abi.json vendor/avalanche-web-abi1/
COPY src/lib/pins/abi-check.ts src/lib/pins/catalogue-source.ts src/lib/pins/types.ts src/lib/pins/
COPY scripts/build-pins.sh scripts/build-avalanche-wasm.sh scripts/check-abi.ts scripts/pins-catalogue.ts scripts/
RUN --mount=type=cache,id=avalanche-web-zig,target=/root/.cache/zig \
    --mount=type=cache,id=avalanche-web-git,target=/var/cache/avalanche \
    AVALANCHE_GIT_CACHE=/var/cache/avalanche/avalanche.git scripts/build-pins.sh /pins

FROM docker.io/library/node:26.10.0-trixie@sha256:a723b54c35a76e947095a20a67d39585bb09c862e6b1adeb8a9f518f95e34fb0 AS site
WORKDIR /src
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run check
RUN npm run lint
RUN npm test
RUN npm run build
RUN node scripts/write-csp-header.ts build csp.caddy

FROM docker.io/library/caddy:2.11.4@sha256:0c994536bddb66445885237f1a5dcc1916bccea922661c76b4e9fc24061f9b52
ARG SOURCE_COMMIT=unknown
LABEL org.opencontainers.image.source="https://github.com/SnowballSH/avalanche-web" \
      org.opencontainers.image.revision="${SOURCE_COMMIT}" \
      org.opencontainers.image.version="${SOURCE_COMMIT}" \
      org.opencontainers.image.title="avalanche-web" \
      org.opencontainers.image.description="Avalanche Web: a static site running the Avalanche chess engine in the browser" \
      org.opencontainers.image.url="https://avalanche.snowballsh.com" \
      org.opencontainers.image.documentation="https://github.com/SnowballSH/avalanche-web/blob/main/docs/image.md" \
      org.opencontainers.image.vendor="SnowballSH" \
      org.opencontainers.image.licenses="GPL-3.0-only"
RUN apk add --no-cache libcap \
 && setcap -r /usr/bin/caddy \
 && apk del libcap \
 && addgroup -S -g 10001 avalanche \
 && adduser -S -D -H -u 10001 -G avalanche -h /nonexistent -s /sbin/nologin avalanche
COPY Caddyfile.container /etc/caddy/Caddyfile
COPY --from=site /src/csp.caddy /etc/caddy/csp.caddy
COPY --from=site /src/build /srv
COPY --from=pins /pins/engines /srv/engines
USER 10001:10001
EXPOSE 8080
