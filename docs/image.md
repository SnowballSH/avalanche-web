# The container image

`Containerfile` builds the image SnowSys runs behind its host Caddy at
`avalanche.snowballsh.com`. It serves static files on `:8080` and nothing
else; every header the site depends on is set here, and the host vhost
passes them through untouched.

## Stages

1. **`pins`** (`node:26` plus Zig 0.16.0, downloaded from ziglang.org and
   checked against its pinned sha256 for the build architecture) runs
   `scripts/build-pins.sh /pins`: every catalogue pin is built from a clean
   checkout of its commit with `-Dversion=<pin id>`, gated on the recorded
   ABI, precompressed, and measured into the served `pins.json`
   ([pins.md](pins.md)). The stage copies only the catalogue, the ABI record
   and the scripts it runs, so its layer is reused until one of them changes.
   Zig's global cache and the Avalanche object cache are BuildKit cache
   mounts, so a catalogue change rebuilds only the commits it adds. Pins are
   never copied into the image unchecked.
2. **`site`** (`node:26`) runs `npm ci`, `check`, `lint`, the unit tests and
   `build`, then `scripts/write-csp-header.ts` writes `csp.caddy` (below).
3. **final** (`caddy:2.11.4`) removes the `cap_net_bind_service` file
   capability from the binary, runs as the unprivileged `avalanche` user
   (uid 10001), and carries `/etc/caddy/Caddyfile`, `/etc/caddy/csp.caddy`,
   the SPA in `/srv` and the pins in `/srv/engines`. The admin API is off and
   nothing under `/srv` is writable by the server. The OCI `source` and
   `revision` labels name the repository and the commit.

All three bases are pinned by digest.

## Headers

`Caddyfile.container` sends, on every response:

- `Cross-Origin-Opener-Policy: same-origin`,
  `Cross-Origin-Embedder-Policy: require-corp` and
  `Cross-Origin-Resource-Policy: same-origin`, which make the page
  `crossOriginIsolated` so the engine can use shared memory;
- the `Content-Security-Policy` from `csp.caddy`;
- `Cache-Control: no-cache` unless a rule below sets it.

`/engines/<id>/avalanche.wasm` is `application/wasm` with
`Cache-Control: public, max-age=31536000, immutable`, as is everything under
`/_app/immutable/`. A pin's URL never changes content: a new build is a new
pin id. `index.html`, the other pages and `/engines/pins.json` keep
`no-cache`, so a deploy is picked up on the next load. Errors are
`text/plain` with `Cache-Control: no-store`, so a 404 is never cached as
immutable. `/health/live` and `/health/ready` answer `ok`.

## The CSP is derived from the build

`kit.csp` in `svelte.config.js` is the single source of the policy, in
`mode: 'hash'`. SvelteKit hashes each page's inline boot script and, because
`adapter-static` prerenders, writes the policy into a `<meta
http-equiv="content-security-policy">` in each page, with that page's hash
only and without `frame-ancestors`, which a meta tag cannot carry.

`scripts/write-csp-header.ts` turns that into the response header: the
configured directives in their configured order, with `script-src` carrying
every page's boot-script hash. It fails the image build when a page has no
CSP meta, when a page's inline script is not covered by its meta, or when a
meta disagrees with the configuration. Nothing hand-writes a hash.

Both policies are enforced, and a browser applies each of them. They agree
on every directive; the header only adds `frame-ancestors 'none'` and lists
the other pages' hashes too. The meta is kept because it is what protects
the pages under `vite preview` and anywhere else the SPA is served without
this Caddyfile.

Vite's asset inlining is off (`build.assetsInlineLimit: 0`). Left on, it
inlines the smallest `@fontsource` subsets as `data:` fonts, which
`default-src 'self'` blocks; the policy stays as the spec writes it and the
fonts ship as files.

## Pins are served precompressed

`file_server { precompressed zstd gzip }` serves `avalanche.wasm.zst` or
`avalanche.wasm.gz` to a client that accepts them, with `Content-Encoding`,
the compressed `Content-Length` and `Vary: Accept-Encoding`, and the raw
`avalanche.wasm` otherwise. The raw file must ship: Caddy looks up the
original before its sidecars. `encode` excludes `/engines/*`, so the wasm is
never compressed on the fly. The zstd sidecar keeps an 8 MiB window, the
limit browsers enforce for HTTP zstd.

## Deep links

`try_files {path} {path}.html /index.html` serves `/analysis` from
`analysis.html` and any other path from the SPA fallback, so a reload of a
client-side route never 404s. `/_app/*` and `/engines/*` are served without
that fallback, so a missing asset is a 404 rather than the HTML shell.

## Running and testing the image

```sh
podman build -f Containerfile -t avalanche-web:local .
scripts/serve-image.sh                  # http://127.0.0.1:8080
npm run test:e2e:served                 # serves the image on 127.0.0.1:8095
```

`scripts/serve-image.sh [image] [port]` runs the image the way the host does
(read-only root, tmpfs `/config`, `/data` and `/tmp`, every capability
dropped, no new privileges) with podman, or docker when podman is absent or
`CONTAINER_ENGINE=docker`. `playwright.served.config.ts` starts it and runs
`tests/e2e/headers.spec.ts` over plain HTTP and `tests/e2e/served.spec.ts`
plus `shell.spec.ts` in Chromium and WebKit. `AVALANCHE_IMAGE` and
`AVALANCHE_SERVE_PORT` override the image and port.

## Publishing

CI builds the image on every push and pull request and runs the served-image
suite against it. On a push to `main`, after both jobs pass, the `publish`
job, the only one holding `packages: write`, pushes that same tested image to
`ghcr.io/snowballsh/avalanche-web` as `sha-<commit>` and `latest` and writes
the registry digest to the run summary. The SnowSys host pulls anonymously,
so the package must be public; the summary reports whether an anonymous pull
of the digest succeeds.
