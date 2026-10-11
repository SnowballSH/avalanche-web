# Engine pins

A pin is one Avalanche commit whose wasm the site serves, built from source
into the site image. The catalogue, the build pipeline and the ABI gate live
in this repository; the engine's source stays in
[SnowballSH/Avalanche](https://github.com/SnowballSH/Avalanche).

## The catalogue

`engines/pins.json` is the source catalogue:

```json
{
	"abi": 2,
	"pins": [
		{
			"id": "v5.0.0-3274054",
			"commit": "327405485fd943dbf0ccaac5539d3841d6e3e1a4",
			"label": "5.0.0",
			"date": "2026-10-11"
		}
	]
}
```

`src/lib/pins/catalogue-source.ts` validates it: `abi` is `2`, `pins` is
non-empty, every `id` starts with `[a-z0-9]` and continues with `[a-z0-9.-]`,
every `commit` is the full 40-character lowercase hash, `label` is non-empty,
`date` is `YYYY-MM-DD`, and no `id` or `commit` repeats. `tests/unit/pins-catalogue.test.ts`
checks the committed file against the schema, so a malformed catalogue fails
`npm test` before any build starts.

The served catalogue, `/engines/pins.json`, is the same document with
`sha256` and `bytes` added to each pin. Both describe the uncompressed wasm:
the browser measures download progress against `bytes` and keys its Cache
Storage entry on `sha256`. The served file is written by the build; nothing
hand-edits those two fields.

## The build

```sh
scripts/build-pins.sh <outdir>
```

For each pin, in catalogue order:

1. `scripts/build-avalanche-wasm.sh <commit> <outdir>/engines/<id>/avalanche.wasm <id>`
   shallow-fetches the commit into a bare cache (`.cache/avalanche.git`, or
   `AVALANCHE_GIT_CACHE`), extracts it with `git archive` into a scratch
   directory, and runs `zig build wasm --release=fast -Dversion=<id>` with
   Zig 0.17.0. The checkout is always clean: nothing but the commit's tree is
   present. With `AVALANCHE_REPO` set to a local clone, the commit's objects
   come from there instead, still without reading its working tree.
   `-Dversion` is what `uci` reports after `id name Avalanche`. Without it,
   the engine embeds the build timestamp, changing the bytes and digest.
2. `node scripts/check-abi.ts` compares the module's imports and exports,
   names and kinds, with `vendor/avalanche-web-abi2/abi.json` and fails the
   build on any difference.
3. `zstd -19 --zstd=wlog=23` and `gzip --best --no-name` write
   `avalanche.wasm.zst` and `avalanche.wasm.gz` next to the wasm; Caddy serves
   them precompressed and never compresses the wasm on the fly. The zstd window
   stays at 8 MiB because browsers refuse larger windows in a `zstd`
   `Content-Encoding` (RFC 9659; Chromium fails the fetch with
   `ERR_ZSTD_WINDOW_SIZE_TOO_BIG`). `--ultra -22` gives a 32 MiB window for
   this module and saved nothing measurable once capped.

`node scripts/pins-catalogue.ts emit` then hashes each wasm and writes
`<outdir>/engines/pins.json`. The whole of `<outdir>/engines` is recreated on
every run, so a retired pin leaves no output behind.

`scripts/fetch-fixture-wasm.sh`, which the integration tests use, calls the
same `build-avalanche-wasm.sh` and only chooses the cache location, so there
is one build path.

The build needs `git`, `zig` 0.17.0, `node`, `zstd` and `gzip`, and refuses
to start when one is missing. The ABI check and the catalogue tooling run
under Node's native type stripping, so the image's pin-building stage must
carry Node as well as Zig.

## Reproducibility

The 5.0.0 wasm is built with Zig 0.17.0 and `-Dversion=v5.0.0-3274054`.
Its compiler-exported `__stack_pointer` global is recorded in ABI 2; the
bindings use only the five functions and memory.
Two local builds, including one with an empty Zig global cache, produced the
same 25 617 474-byte wasm with sha256
`c3ec3895cc29fa53e55177f5206342ebd49471614e0210e2b1bc24407244f76e`.
The `.zst` and `.gz` siblings also matched byte for byte. The first uncached
Ubuntu CI build (run `38163250703`, head `7cf18c5`) emitted
`v5.0.0-3274054 c3ec3895cc29fa53e55177f5206342ebd49471614e0210e2b1bc24407244f76e 25617474`,
matching the local wasm digest and byte count.

## CI

The `verify` job installs Zig 0.17.0 with `mlugg/setup-zig`, restores
`build-pins/out` from a cache keyed on `engines/pins.json`, the build scripts
and the catalogue validator, runs `build-pins.sh` on a miss, runs
`scripts/check-pins-abi.sh build-pins/out` (which fails on an empty pin list,
a missing wasm, or an ABI difference, so a restored cache is gated too), and
then runs `npm run test:integration` with `AVALANCHE_FIXTURE_WASM` pointing
at the first pin.

## Adding a pin

1. Pick a commit on the public repository at or after `870eeab`. An older
   commit needs a second Zig toolchain; the current pin builder uses 0.17.0.
   Confirm its wasm exports and imports match `abi.json` with
   `scripts/build-avalanche-wasm.sh <commit> /tmp/candidate.wasm <id>` and
   `node scripts/check-abi.ts /tmp/candidate.wasm`. An ABI change needs a new
   version and design review.
2. Add an entry to `engines/pins.json`. Put a pin meant to be the fallback
   default first; the first catalogue entry is used when the visitor's saved
   choice is unavailable. Do not simply append a new default. The `id` is
   `<branch-or-tag>-<7-char short hash>`, the `commit` is the full hash, the
   `label` is what the pin picker shows, and the `date` is the commit date.
3. Update the matching literals in `scripts/fetch-fixture-wasm.sh`, the CI
   fixture path, `tests/unit/`, `tests/integration/`, `tests/e2e/`, and the
   pin and image documentation. Update measured size text after building.
4. Run the local gates, build the image, and open a pull request. After the
   image is published, an operator initiates **Deploy** in snowdeploy. A
   hand-edited digest pull request does not ship the image.

## Retiring a pin

Remove its entry from `engines/pins.json` and open a pull request. The next
image no longer contains that wasm; a visitor who downloaded it keeps a
`stale` copy in Cache Storage until they delete it from the Engines page.
Never reuse a retired `id` for a different commit.
