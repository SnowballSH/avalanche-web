# Engine pins

A pin is one Avalanche commit whose wasm the site serves, built from source
into the site image. The catalogue, the build pipeline and the ABI gate live
in this repository; the engine's source stays in
[SnowballSH/Avalanche](https://github.com/SnowballSH/Avalanche).

## The catalogue

`engines/pins.json` is the source catalogue:

```json
{
	"abi": 1,
	"pins": [
		{
			"id": "master-9b7ee6f",
			"commit": "9b7ee6ff829dcfb5ee5e48d8dcb83bd44c26a642",
			"label": "4.0.0+ (master, 2026-09-27)",
			"date": "2026-09-27"
		}
	]
}
```

`src/lib/pins/catalogue-source.ts` validates it: `abi` is `1`, `pins` is
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
   Zig 0.16.0. The checkout is always clean: nothing but the commit's tree is
   present. With `AVALANCHE_REPO` set to a local clone, the commit's objects
   come from there instead, still without reading its working tree.
   `-Dversion` is what `uci` reports after `id name Avalanche`; since
   9b7ee6f a build without it embeds its build timestamp instead, so the
   bytes, and the digest, would differ on every run.
2. `node scripts/check-abi.ts` compares the module's imports and exports,
   names and kinds, with `vendor/avalanche-web-abi1/abi.json` and fails the
   build on any difference.
3. `zstd --ultra -22` and `gzip --best --no-name` write `avalanche.wasm.zst`
   and `avalanche.wasm.gz` next to the wasm; Caddy serves them precompressed
   and never compresses the wasm on the fly.

`node scripts/pins-catalogue.ts emit` then hashes each wasm and writes
`<outdir>/engines/pins.json`. The whole of `<outdir>/engines` is recreated on
every run, so a retired pin leaves no output behind.

`scripts/fetch-fixture-wasm.sh`, which the integration tests use, calls the
same `build-avalanche-wasm.sh` and only chooses the cache location, so there
is one build path.

The build needs `git`, `zig` 0.16.0, `node`, `zstd` and `gzip`, and refuses
to start when one is missing. The ABI check and the catalogue tooling run
under Node's native type stripping, so the image's pin-building stage must
carry Node as well as Zig.

## Reproducibility

The 9b7ee6f build is byte-stable: three runs on the same machine, one with an
empty Zig global cache (`ZIG_GLOBAL_CACHE_DIR` pointed at a fresh directory),
produced the same 25 698 005-byte wasm with sha256
`c4f96c537ae5a3a1ece49642aa67a034e2bc570213413dadc91233a6c5a4cb80`, and
identical `.zst` and `.gz` siblings. A control build of the same commit
without `-Dversion` produced a different module
(`18eca58ba1b03dcae2cf11a39d5dc6dc81aefed662c8024e960c2947592d0f5c`) that
reports `id name Avalanche Compiled at 2026-09-27-22:31 UTC`, which is why
the build script requires the version argument. If a platform ever
produced a different digest, the served `sha256` would still be correct for
the bytes actually served, since it is measured from the output rather than
declared.

## CI

The `verify` job installs Zig 0.16.0 with `mlugg/setup-zig`, restores
`build-pins/out` from a cache keyed on `engines/pins.json`, the build scripts
and the catalogue validator, runs `build-pins.sh` on a miss, runs
`scripts/check-pins-abi.sh build-pins/out` (which fails on an empty pin list,
a missing wasm, or an ABI difference, so a restored cache is gated too), and
then runs `npm run test:integration` with `AVALANCHE_FIXTURE_WASM` pointing
at the first pin.

## Adding a pin

1. Pick a commit on the public repository, not older than `910711f`, and
   confirm its wasm exports and imports match `abi.json`
   (`scripts/build-avalanche-wasm.sh <commit> /tmp/candidate.wasm <id>` then
   `node scripts/check-abi.ts /tmp/candidate.wasm`). A commit whose ABI
   differs needs a new ABI version: a new `vendor/avalanche-web-abi<N>/`
   directory produced by `scripts/vendor-abi.sh`, its own `abi.json` from
   `scripts/record-abi.mjs`, and a catalogue with `abi: N`. The site never
   serves two ABI versions from one catalogue.
2. Append an entry to `engines/pins.json`. The `id` is
   `<branch-or-tag>-<7-char short hash>`, the `commit` is the full hash, the
   `label` is what the pin picker shows, and the `date` is the commit date.
3. Run `npm test`, then `scripts/build-pins.sh build-pins/out` locally and
   check the emitted `sha256` and `bytes`.
4. Open a pull request. CI rebuilds every pin (the cache key changed) and
   gates the new one on the ABI. After the merge, a normal snowdeploy digest
   pull request ships the new image.

## Retiring a pin

Remove its entry from `engines/pins.json` and open a pull request. The next
image no longer contains that wasm; a visitor who downloaded it keeps a
`stale` copy in Cache Storage until they delete it from the Engines page.
Never reuse a retired `id` for a different commit.
