# Architecture

The full design is the Avalanche Web spec in the SnowSys repository. This
file records the decisions the code in this repository rests on.

## Static output and the SPA fallback

`src/routes/+layout.ts` sets `prerender = true`, so every page renders to
`build/<route>.html` at build time. `adapter-static` also writes an SPA
fallback to `build/index.html`, which the container's Caddyfile serves with
`try_files {path} {path}.html /index.html`.

The adapter writes the fallback after the prerendered pages, so a prerendered
`/` would be overwritten. The root route therefore opts out of prerendering
and redirects to `/analysis` from its `load`; the fallback shell boots the
client router, which performs that redirect.

## Theme before first paint

Foundation UI's dark theme keys off `data-theme` on `<html>`. The attribute
is set by `static/theme-init.js`, a synchronous external script referenced
from `src/app.html`, rather than by an inline script. The site's CSP allows
only `'self'`, `'wasm-unsafe-eval'` and the hash of SvelteKit's own boot
script for `script-src`, so an inline theme script would be blocked once
`kit.csp` hash mode is on. The script mirrors Foundation UI's `readTheme`:
the stored `fui-theme`, else `prefers-color-scheme`. `ThemeToggle` writes the
same key.

## Styles and fonts

`src/app.css` imports the two variable fonts, Tailwind, Foundation UI's
tokens and theme, and declares `@source "../node_modules/foundationui"` so
the components' utilities are generated. Foundation UI ships no font bytes;
`@fontsource-variable/inter` and `@fontsource-variable/jetbrains-mono` are
self-hosted through npm.

## Tooling notes

- `svelte-check` 4 accepts TypeScript 5 or 6 as a peer, so TypeScript is
  pinned to the latest 6.x rather than 7.
- Biome lints only the `<script>` block of a `.svelte` file, so
  `noUnusedImports` and `noUnusedVariables` are off for `*.svelte`; symbols
  used only in the template would otherwise be reported.
- `npm run format` runs `biome check --write`, so that formatting and import
  order are fixed by the same command that `npm run lint` checks.

## Vendored engine bindings

`vendor/avalanche-web-abi1/` is Avalanche's `web/src` and MIT `LICENSE` at
the commit named in its `SOURCE` file, copied verbatim; `abi.json` next to
them records the wasm import and export names and kinds that
`WebAssembly.Module.imports`/`exports` report for the build of that commit.
`scripts/vendor-abi.sh <commit>` re-derives the copy from the commit's git
objects (a local clone through `AVALANCHE_REPO`, else a shallow fetch from
GitHub) and with `--check` fails on any drift, so the vendored tree can never
be edited in place. `node scripts/record-abi.mjs <avalanche.wasm>` regenerates
`abi.json`; a pin whose ABI differs from it belongs to a new ABI version with
its own vendored directory.

The vendored sources import each other with `.ts` extensions and use
`Promise.withResolvers`, so `tsconfig.json` sets `allowImportingTsExtensions`
and `rewriteRelativeImportExtensions` on top of SvelteKit's `esnext` lib. Its
`src/node/` adapters (a worker-thread client and a stdio CLI) need Node's
globals, which the app never uses, so they are excluded from the type check;
Biome skips `vendor/` entirely, since upstream formats it with its own
configuration and the drift check would reject any reformatting.

`src/lib/engine/uci-parse.ts` and `capabilities.ts` parse the engine's
output lines into the contracts below. `parseInfoLine` walks tokens and
skips any it does not know (`wdl`, `hashfull`, `tbhits`, `currmove`), so a
trailing `wdl W D L` after the score never breaks a line, and returns nothing
for a line without both `depth` and `score`. `parseOptionLine` keeps the
spaces inside names such as `Move Overhead` and maps a `string` default of
`<empty>` to the empty string, which is what that UCI marker means.

## Planned layout

```
src/lib/engine/   EngineHost, UciSession, capabilities, scheduler
src/lib/pins/     PinCatalog, PinStore
src/lib/chess/    GameTree, PGN/FEN io, FRC, adjudication
src/lib/board/    chessground wrapper
src/lib/play/     Clock, PlayController
src/lib/shell/    Header and navigation
src/routes/       analysis/, play/, engines/, editor/
vendor/           vendored Avalanche bindings per ABI version
engines/          pins.json and the build-pins script
```

## Contracts

The interfaces below live in `src/lib/{engine,pins,chess,play}/types.ts` and
are the names later work builds against. Each module's `types.ts` carries
types only; implementations arrive in their own files. The import graph is a
line: `play` → `chess` → `engine` → `pins`, with no cycles.

### Engine (`src/lib/engine/types.ts`)

- `UciSession` is the only writer of UCI text. `handshake()` sends `uci`,
  collects the `option` lines and returns `EngineCapabilities`; `setOption`
  validates against those capabilities; `position(startFen, moves)` and
  `search(limits)` follow. `search` returns a `SearchHandle` synchronously:
  its `searchId` is strictly increasing per session, `info` is an async
  iterable of `SearchInfo`, `result` resolves with the `BestMove`, and
  `stop()` / `ponderhit()` raise the corresponding search signal. Every
  parsed line carries the `searchId` it was produced under, so a line from a
  superseded search can be recognised and dropped rather than rendered
  against a newer position. `result` resolves once the engine's `bestmove`
  arrives, including after `stop()`; it rejects with a `SearchAbortedError`
  (`reason: "terminated"` or `"crashed"`) when the host terminates the
  worker or the worker crashes before that. A `position` call issued while a
  search runs stops that search first, so its `result` still resolves.
  `capabilities` is `null` until `handshake()` has completed and then holds
  its result; `handshake()` is idempotent and returns the same capabilities
  on every later call without re-sending `uci`.
- `SearchLimits` is either `{ infinite: true }` or any combination of
  `depth`, `nodes`, `movetime` and the clock fields (`wtime`, `btime`,
  `winc`, `binc`, `movestogo`); either form may add `ponder: true`, which
  becomes `go ponder`. A `BoundedSearch` with no bound at all (`{}`) is
  sent as `go infinite`: the session never issues a bare `go`, whose end
  the caller could not predict.
- `BestMove.move` is `null` for `bestmove (none)` and for `bestmove 0000`,
  which is what Avalanche prints when there is no legal move
  (`search.zig:554`).
- The engine's terminal line for a position with no legal moves is
  `info depth 0 score mate 0` (in check) or `info depth 0 score cp N`
  (stalemate), with no `multipv` and no `pv` (`search.zig:534`). The parser
  yields a `SearchInfo` with `multipv: 1` and an empty `pv` for it.
- `EngineCapabilities.options` maps each advertised option name to its
  `UciOptionSpec`; the derived flags (`threadsMax`, `supportsLimitStrength`,
  `eloRange`, `multiPvMax`, `supportsChess960`) are what the UI reads. A pin
  that does not advertise `UCI_Elo` has `eloRange: null`.
- `EngineHost` owns one Worker per active pin. `start(pin, options)` posts
  the vendored `init` message, whose payload is `wasmUrl` and the
  `signalBuffer` (the shared stop/ponderhit signal) and never bytes; the host
  sets `wasmUrl` to the pin's cache key (`PinCacheKeyFn` below), and the
  wrapped worker's loader answers that key from the `avalanche-pins-v1`
  Cache Storage. No `blob:` URL is involved, since `connect-src 'self'`
  would refuse one. When the key is not in the cache (the pin was deleted in
  another tab) the loader fails with a `PinUnavailableError`. `start` and
  `restart` resolve only after the worker is ready, `handshake()` has
  produced the capabilities, and `Hash` (and `Threads`, when given) has been
  applied, so the returned session's `capabilities` is never `null` and any
  hash notice has already been delivered.
- `EngineStartOptions` carries what needs a fresh worker: `hashMb` and,
  when the pin advertises `Threads` max > 1, `threads`. Everything else
  (`MultiPV`, `UCI_Elo`, `UCI_Chess960`, `Ponder`) goes through
  `setOption` on the live session.
- `EngineNotice` is delivered through `onNotice`. The
  `hash-allocation-failed` notice comes from the engine's
  `info string Hash: failed to allocate N MB, still using M MB` line and
  carries `requestedMb` and `effectiveMb`; the host records `effectiveMb` as
  `effectiveHashMb`, which the UI shows instead of the requested size. The
  `engine-error` notice comes from `info string error: …`. Neither restarts
  the worker. A worker trap, load failure or undecodable message goes to
  `onCrash` as an `EngineCrash` with the pin and the search that was running.
- `EngineScheduler` hands out at most one `EngineLease` per owner. Acquiring
  a `play` lease suspends an active `analysis` lease; releasing it lets
  analysis resume. The lease's `state` and `onStateChange` are how the
  analysis controller learns to stop and to restart its search. A second
  `acquire` for an owner whose lease is still `active` or `suspended` throws
  a `LeaseConflictError`; the owner must `release` first. Releasing a lease
  twice is a no-op.

### Pins (`src/lib/pins/types.ts`)

- `PinEntry` mirrors one row of the served `/engines/pins.json`, and
  `PinCatalogData` is the whole document with its `abi`. `PinCatalog.load()`
  fetches it.
- `PinCacheName` is the literal `"avalanche-pins-v1"`, and `PinCacheKey` is
  `/engines/<id>/avalanche.wasm?sha256=<hex>`. `PinCacheKeyFn` is the
  signature of `pinCacheKey(pin)`; both the constant and the function are
  implemented in `src/lib/pins/cache-key.ts`. Keying on id and sha256 means
  a rebuilt pin with a new hash never reads a stale cache entry.
- `PinState` is `absent`, `downloading` with a `fraction` measured against
  `PinEntry.bytes` (the transfer is precompressed, so `Content-Length` is
  not the wasm size), `ready`, `corrupt` (sha256 mismatch; nothing cached),
  or `stale` (cached but no longer in the catalogue). `PinStore.list`
  takes the catalogue's pins and returns a `PinStatus` for each of them plus
  a `StalePinStatus` for every cache entry the catalogue no longer names.
- `PinStore.download` buffers the whole file, verifies the sha256, and only
  then writes a `Response` with `Content-Type: application/wasm` into the
  cache; `get` returns that cached `Response`. Failures reject with a
  `PinStoreError` whose `code` is `network`, `corrupt`, `quota` or `missing`.
  `usage()` reports `StorageUsage`, and `requestPersistence()` resolves with
  whether `navigator.storage.persist()` was granted.
- `GetDefaultPin` and `SetDefaultPin` type the default-pin choice that
  the pin layer keeps in `localStorage`; the getter falls back to the first
  catalogue pin when the stored id has been retired, and returns `null` only
  for an empty catalogue.

### Chess (`src/lib/chess/types.ts`)

- `GameTree` is a tree of `GameNode`s addressed by `NodeId`. `root` holds
  the start position and no move. `mainline()` and `pathTo(id)` return
  ordered node ids; `addMove` returns the existing child when the move is
  already present, so transpositions within a node do not duplicate;
  `promote(id)` makes a variation the first child at every ancestor along
  its path; `deleteFrom(id)` removes the subtree, and `deleteFrom(root)` is
  a no-op, so the tree always has its root. `addMove` with a move that is
  illegal in the parent's position throws an `IllegalMoveError` carrying the
  `fen` and `uci`, and leaves the tree unchanged. `setComment`, `setNags`
  (PGN numeric annotation glyphs, kept in order so import and export round
  trip) and `setEval` annotate a node; `node(id)` reads the annotated node
  for export.
- `StartPosition` is `standard`, a `fen`, or `frc` with a Scharnagl number
  0–959. `GameTree.start` keeps it so PGN export can emit `[Variant
  "Chess960"]` and `[FEN …]`.
- `GameResult` is the `winner` (`white`, `black` or `draw`) and the
  `reason`: `checkmate`, `stalemate`, `threefold`, `fifty-move`,
  `insufficient`, `flag`, `resign` or `agreement`.

### Play (`src/lib/play/types.ts`)

- `Clock` is built by a `ClockFactory` from a `TimeControl` (`baseMs`,
  `incrementMs`) and a `MonotonicNow` time source. `start(side)` starts the
  clock for that side; `press()` charges the elapsed time to the running
  side, adds the increment, switches sides and returns the presser's
  remaining time. `remaining(side, now)` and `flagged(now)` take the
  timestamp explicitly, so a backgrounded tab whose timers were throttled
  still charges the full elapsed time when it returns. `stop(now)` charges
  the running side up to `now` and stops both clocks, so that after
  checkmate, resignation or agreement `flagged()` can never report a flag.
  `snapshot(now)` returns a serialisable `ClockSnapshot` (remaining ms per
  side and the running side or `null`) for the persisted game; passing it
  as `restore` in `ClockOptions` rebuilds the clock with those remaining
  times, and the restored running side starts being charged from the moment
  of restore, not from the snapshot, since the game was not being played
  while the tab was closed.

## Engine lifecycle

```
                 PinStore.download ─── sha256 ok ───► Cache Storage
                                                          │
  EngineHost.start(pin, {hashMb, threads?})               │ match(pinCacheKey)
        │                                                 ▼
        ├─ new Worker ── init {wasmUrl: cacheKey} ──► loader ──► WebAssembly.compile
        │                                                 │
        │◄──────────────── ready ─────────────────────────┘
        ▼
  UciSession.handshake() ── uci ─► option lines ─► uciok ─► EngineCapabilities
        │
        ├─ setOption Hash ─► "info string Hash: failed to allocate N MB, still using M MB"?
        │                        └─► onNotice(hash-allocation-failed) ; effectiveHashMb = M
        ├─ position / search / stop ... (searchId increases; stale lines dropped)
        │
        ├─ Hash change or pin change ─► terminate worker ─► start again (memory never shrinks)
        └─ worker error / trap ─► onCrash(EngineCrash) ─► UI offers restart(options)
```

## Scheduler priority

```
  analysis acquires ──► lease A: active ──────────────► search runs
                                     │
  play acquires ──────► lease P: active ; A ──► suspended (analysis stops its search)
                                     │
  play releases ──────► P: released  ; A ──► active     (analysis restarts its search)
```

One engine worker serves the site; an active game outranks the analysis
board, and analysis is never silently dropped, only suspended until play is
done.
