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

The pin catalogue, the build that turns each pinned commit into a served
wasm, and the ABI gate that rejects a mismatching build are described in
[`pins.md`](pins.md).

The chessground wrapper, the promotion picker, the evaluation bar and graph,
the score conventions they share and the piece-set licence are described in
[`board.md`](board.md).

The analysis page, its controller, the browser-wide engine runtime and the
local serving that the end-to-end tests rely on are described under
[The analysis board](#the-analysis-board) below.

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

## Engine runtime

`src/lib/engine/session.ts` implements `UciSession` as `UciSessionRuntime`
over a `LineTransport` (one `send(command)` method); the host feeds the
engine's output back through `receive(line)`, so the unit tests drive it with
a scripted fake and never a worker. The worker executes commands strictly in
order and a search blocks it until `bestmove`, so output arrives in command
order: the session keeps a FIFO of searches whose `go` has been sent and
whose `bestmove` has not arrived, attributes `info` lines to the head of that
queue, and pops it on `bestmove`. That is what gives every parsed line its
`searchId`. `search()` sends `stop` for the running search before its own
`go`; `position`, `newGame` and `setOption` also mark the running search
superseded, which closes its `info` stream and drops any further lines while
still resolving its `result`, because a queued state change would otherwise
wait behind an infinite search and its late lines would describe the old
position. Every state-changing command is followed by `isready`, and the
returned promise resolves on the matching `readyok`. `abort(reason)` rejects
every pending search, handshake and `isready` and refuses further commands.
A handle's `info` stream has a single consumer: a second
`[Symbol.asyncIterator]()` throws, and breaking out of the loop (`return()`)
closes the stream so later lines are dropped rather than buffered.

`src/lib/engine/host.ts` implements `EngineHost` as `WorkerEngineHost`,
parameterised by an `EngineConnectionFactory` that turns a pin into a
`{send, terminate}` connection and receives the line and failure callbacks.
`createBrowserEngineHost()` binds the factory that starts
`src/lib/engine/worker.ts` as a module Worker and drives it with the vendored
`AvalancheClient`; the integration test binds one that starts the vendored
Node worker-thread client on a local wasm file. The host parses every line
with `parseEngineNotice`, so a Hash-failure notice updates `effectiveHashMb`
while the `setOption("Hash")` round trip is still in flight, and `start`
resolves with the corrected value already recorded. A connection failure
after `ready` aborts the session with `crashed`, terminates the worker and
emits `EngineCrash`; the pin is kept so `restart(options)` can reuse it.
`start`, `restart` and `terminate` may overlap: each `start` and `terminate`
bumps a generation counter, and a `start` that finds the counter moved after
any of its awaits retires the worker it opened and rejects with
`EngineStartSupersededError`, so two overlapping restarts leave exactly one
worker. Line and failure callbacks are ignored unless they come from the
engine the host currently holds, since a terminated worker's queued messages
can still be delivered. A failure after the worker opened (a `Threads`
value above the pin's maximum, checked before `Hash` is sent, or a crash
mid-handshake) retires that worker, clears the host and rethrows.

`src/lib/engine/pin-loader.ts` is the loader `worker.ts` gives `serveEngine`:
it opens the `avalanche-pins-v1` cache and matches the key it was handed.
`serveEngine` and `AvalancheClient` carry a worker-side failure across the
thread boundary as a message string, so `PinUnavailableError` uses a fixed
message prefix and `PinUnavailableError.fromMessage` rebuilds the typed error
on the main thread, where `start` rejects with it.

`src/lib/engine/memory.ts` derives the Hash choices: powers of two from 16 MB
up to `hashCapMb(navigator.deviceMemory)`, which is
`min(1024, deviceMemory * 128)` rounded down to a power of two, or 256 MB
when `deviceMemory` is absent.

`src/lib/engine/scheduler.ts` keeps one lease per owner in a map; a lease
transitions in place and notifies its listeners, and `release` of a lease
that is no longer the held one is a no-op.

The integration test, `npm run test:integration`, runs
`tests/integration/engine.node.test.ts` under `vitest.integration.config.ts`
against the real `master-9b7ee6f` wasm in a Node worker thread. The fixture
comes from `scripts/fetch-fixture-wasm.sh`, which builds the commit with Zig
0.16.0 and `-Dversion=master-9b7ee6f` from a scratch checkout of
`AVALANCHE_REPO` (or a shallow fetch from GitHub) into the git-ignored
`.cache/fixtures/`, and reuses the file once it exists. CI runs it against
the pin it has just built, through `AVALANCHE_FIXTURE_WASM`.

Each worker the integration test starts gets an `EngineTap`
(`tests/integration/helpers/engine-tap.ts`) between the engine and the host:
it records every line and can hold delivery to the host. The superseded-search
case uses it to make the in-flight race deterministic: after the first `info`
of a `go infinite`, it holds delivery, waits (bounded) until the real engine
has printed another `info depth` line, changes the position, then releases.
Those held lines reach the host only after the change, as they would with
real message latency, and the test asserts the stale stream received exactly
the infos parsed from lines delivered before the change.

## Planned layout

```
src/lib/engine/   EngineHost, UciSession, capabilities, scheduler
src/lib/pins/     PinCatalog, PinStore
src/lib/chess/    GameTree, PGN/FEN io, FRC, adjudication
src/lib/board/    chessground wrapper
src/lib/analysis/ AnalysisController, move tree, engine panel, import/export
src/lib/shared/   engine runtime singleton, StartPositionPicker
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
- `src/lib/pins/store.ts` implements it. `get` never downloads: a miss rejects
  with `missing`, and callers run `download` first. `download` on a pin the
  cache already holds reports `1` and resolves without a fetch. The transfer
  is fetched with `cache: "no-store"` so the HTTP cache holds no second copy
  of a 25 MB file. A `200` whose `Content-Type` is not `application/wasm` is
  a `network` failure, not `corrupt`: the container's `try_files` answers a
  pin missing from the image with the HTML shell. The body lands in one
  preallocated buffer of `PinEntry.bytes`; one that overruns or falls short
  of that length is `corrupt` like a digest mismatch, and the reader is
  cancelled on every failure path. Concurrent `download` calls for the same
  key share one transfer; a progress listener that throws is skipped and
  never fails the transfer. `delete` cancels an in-flight transfer of that
  id, which then rejects with `missing` instead of landing the pin after the
  user removed it. The `downloading` and `corrupt` marks live in the store
  instance, so another tab sees only `ready` or `absent`. `usedBytes` sums
  every entry in the cache (from the `Content-Length` header written at
  `put` time, else the blob size), including any entry whose key is not a
  pin key, so nothing is orphaned invisibly; `list` reads sizes only for
  stale entries. `quotaBytes` comes from `StorageManager.estimate()`, `null`
  when it gives none. `cache-key.ts` owns the key format and its inverse,
  `parsePinCacheKey`.
  Browsers evict script-writable storage (Safari after seven days without
  interaction), which shows up as `absent`; the Engines page must not
  promise permanence.
- `src/lib/pins/catalog.ts` fetches `/engines/pins.json`, validates the
  source fields through `catalogue-source.ts`, then the served `sha256`
  (64 lowercase hex) and `bytes` (positive integer) per pin, and rejects with
  a `PinCatalogueError` on an HTTP failure, a non-JSON body or an invalid
  document.
- `GetDefaultPin` and `SetDefaultPin` type the default-pin choice that
  the pin layer keeps in `localStorage`; the getter falls back to the first
  catalogue pin when the stored id has been retired, and returns `null` only
  for an empty catalogue. `src/lib/pins/default-pin.ts` keeps the id under
  `avalanche.defaultPin`; every storage access is wrapped, so a throwing or
  absent `localStorage` degrades to the first-pin fallback.

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

#### Rules, notation and the engine's move format

The rules, SAN, FEN and PGN come from chessops. `createGameTree` (`tree.ts`)
holds one normalised FEN per node and rebuilds the chessops position from it
on demand, with a small cache of the most recently added positions so
consecutive `addMove` calls do not re-parse the parent.

`GameNode.move` is the string the engine expects for that tree's mode, so
`pathTo(id)` maps straight onto `position startpos moves …`:

- a `standard` or `fen` start runs the engine without `UCI_Chess960`, and
  castling is stored as the king's destination (`e1g1`);
- an `frc` start runs it with `UCI_Chess960 true`, and castling is stored as
  king-takes-rook (`e1h1`).

`addMove` accepts either form on input; chessops normalises both. A `fen`
start always runs in standard mode, so a position whose castling rights do
not have the king on the e-file and the rook on the a- or h-file cannot be
played from it: `parseFen` rejects it with `unsupported-variant` (the message
points at the FRC start; dropping the castling rights makes it acceptable)
unless the caller passes `{ chess960: true }`, which the FRC paths do. That
is why a Chess960 PGN must start from one of the 960 start positions, and
`createGameTree` throws `InvalidStartError` (carrying the same `ImportError`)
for a `fen` start that `parseFen` would reject.

`parseFen` (`fen.ts`) validates the text and the legality of the setup and
returns the normalised FEN or an `invalid-fen` error. `frcFen(n)` (`frc.ts`)
derives the Scharnagl position, emitting X-FEN castling (`KQkq`, which
chessops normalises to for the outermost rooks); `frcNumber(fen)` inverts it
by comparing the first four FEN fields against the table, so the move
counters are ignored, and `randomFrc()` draws from `crypto` without modulo
bias. Position 518 is the standard start.

#### PGN import and export

Import is sized for a hostile paste. `importPgn` refuses input over
`MAX_IMPORT_BYTES` (5 MB, measured in UTF-8) before parsing, turns a chessops
parser budget overrun into `malformed`, and returns `no-games` when nothing
in the text is a game. It parses the text and returns the games with their
headers, but replays no moves: each `ImportedGame.tree()` resolves that
game's start and builds its tree on first call (memoised), returning
`invalid-fen`, `unsupported-variant` or `illegal-move` (with the game index,
the 1-based ply and the SAN) as a typed error. An illegal move rejects the
whole game: no prefix of it is kept. So a 5 MB paste costs only the
parse, and a broken game does not block the others: the picker lists every
game and the error appears for the one the user opens. Nothing in the import
path throws on bad input.

Chess960 is detected from the `Variant` tag (`Chess960`, `Chess 960`,
`Fischerandom`, case-insensitive); with no `FEN` tag it is position 518.
Other variants are `unsupported-variant`. A `FEN` tag without a variant is a
`fen` start.

Comments carry evaluations as lichess does: `[%eval 0.30,20]` or
`[%eval #4,30]` from White's point of view, while `SearchInfo.score` is from
the side to move, so import and export negate the value on Black-to-move
nodes. A comment before a variation's first move is folded into that move's
comment. `exportPgn` writes the seven-tag roster (caller headers override it,
and extra headers follow it), derives `Variant`, `SetUp` and `FEN` from
`tree.start` (never from the caller's headers), emits every variation with
its NAGs and comments, and appends evaluation comments when `evals` is set.

#### Adjudication and the draw offer

`adjudicate(fen, history)` (`adjudicate.ts`) checks, in order, checkmate,
stalemate, insufficient material, the fifty-move rule (halfmove clock at
100) and threefold repetition, where `history` is the FEN of every earlier
position in the game and repetition compares the first four FEN fields.
Insufficient material follows chessops: bare kings, a lone minor piece, or
bishops that all stand on one colour draw, while opposite-coloured bishops
and two knights against a bare king do not.
`drawOfferAccepted(scores)` takes the engine's final score for each of its
own moves, oldest first, and accepts when there are at least ten and the last
ten are all exact centipawn scores within ±20; a mate score or a bounded
score in the window rejects.

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

## The analysis board

`src/routes/analysis/+page.svelte` wires the board, the move tree, the engine
panel and the import/export tools to one `AnalysisController`
(`src/lib/analysis/controller.ts`). The controller is plain TypeScript: it
holds the `GameTree`, the cursor, the engine status and the current engine
lines, and publishes an immutable `AnalysisState` snapshot to its subscribers
on every change. The tree itself is mutable, so the snapshot carries a
`revision` that increases whenever the tree changes; the page's derived values
read it to recompute.

### Driving the engine

`setEngine(true)` acquires the `analysis` lease and, while the lease is active,
(re)starts an infinite search on the node under the cursor. Every restart bumps
a generation counter, stops the running search, clears the lines, then awaits
the session, the options, `position` and `go`, bailing out if the generation
moved on at any await. The loop that consumes a search's `info` stream drops
every line once its generation is stale, on top of the session's own
superseded-search guard, so a line from the previous position never renders
against the new one.

Before each search the controller applies `MultiPV`, `UCI_Chess960` (true for
an FRC start) and `UCI_LimitStrength false` whenever the session or those
values changed since it last applied them; the play page may have used the
same session in between, so the options are re-applied after every resume.

The controller owns stopping its own search when its lease is suspended: it
listens to the lease's `onStateChange`, and on `suspended` stops the search,
forgets the session and shows "paused"; on `active` it reconnects and restarts
the search on the current node. Switching the engine off stops the search and
releases the lease.

The best line (`multipv 1`, exact score) is stored on its node with `setEval`
when it is at least as deep as the stored one; PGN export with evaluations and
the evaluation graph read it. Scores reach the UI through `whitePovAt` at the
searched node, never raw.

### Engine runtime

`src/lib/shared/engine-runtime.ts` is the browser-wide singleton: one
`EngineHost` (one worker), the scheduler, the `PinStore` and a memoised
catalogue load. Its `EngineSessionCache` (`src/lib/engine/session-cache.ts`)
returns the running session while the pin, Hash and Threads are unchanged and
starts a new worker otherwise (an unset Threads and `Threads 1` are the same
key); a crash or a failed start clears it. The page's `connect` goes through
an `EngineConnector` (`src/lib/analysis/engine-connector.ts`): it loads the
catalogue, picks the chosen pin (else the default pin), runs
`PinStore.download` with progress (it resolves at once for a cached pin, since
`get` never downloads), then asks the cache for a session, passing `threads`
only above one. Every `connect` bumps a generation; a superseded connect
rejects with `EngineConnectSupersededError` after its download and before
`ensure`, so it never starts a worker that would replace the newer one, and
only the current connect may update the progress bar, the pin, the effective
Hash or the Threads maximum. Changing the pin, the Hash or the Threads calls
`reconnect()`, which restarts the search on the new worker. A Hash allocation notice is shown with the size in effect.

When `crossOriginIsolated` is false the engine switch is disabled and the
panel explains why: the engine is stopped through a `SharedArrayBuffer`, which
only a cross-origin isolated page may create.

### Move tree and keyboard

`moveTokens` (`src/lib/analysis/move-tokens.ts`) flattens the tree into move,
"(" and ")" tokens iteratively, so a long game never recurses. A variation's
first move and the main-line move after a variation are numbered, with `N…`
for Black.

| Key | Action |
| --- | --- |
| ← / → | parent / first child |
| ↑ / ↓ | previous / next sibling variation |
| Home / End | start position / end of the current line |

Keys are ignored while focus is in a text field, a select or the promotion
picker.

### Import, export and links

`pasteKind` (`src/lib/analysis/paste-kind.ts`) treats a paste as a FEN when
it is one line of at most 256 characters whose first field has eight
`/`-separated ranks, and as PGN otherwise, so `1. d4 d5 2. c4 1/2-1/2` imports
as a game. `importPgn` enforces the 5 MB cap and builds only
the picked game's tree; any error is shown inline and the current tree is
kept. A multi-game paste lists the games to pick from. A FEN whose normalised
form differs from the input (for example castling rights without their rook)
is echoed back as "Loaded as …". PGN export keeps an imported game's headers.

`src/lib/analysis/hash-link.ts` writes `#fen=` links with spaces as `_`; the
page loads the hash on start and on every `hashchange`, and an invalid FEN
shows an error and keeps the position.

`src/lib/shared/StartPositionPicker.svelte` emits a `StartPosition`: standard,
a FEN validated by `parseFen` (the normalised form is echoed), or an FRC
Scharnagl number 0–959 typed or drawn with `randomFrc`.

### The board editor

`src/routes/editor/+page.svelte` edits an `EditorState`
(`src/lib/editor/editor-state.ts`): the piece placement, the side to move,
the four castling flags, the en passant square and the move counters, all
immutable, with pure functions for each edit. Nothing is validated while the
user edits, so an illegal board (no kings, a pawn on the back rank) can be
loaded, shown and fixed. `validateEditor` is the only gate: an en passant
square that no double pawn push could have produced is refused with a reason,
and everything else goes through `parseFen`, whose message becomes the
reason (including the Chess960-castling refusal). A position `parseFen`
accepts but normalises (a castling right without its rook, an en passant
square no pawn can capture on) is shown with the FEN it will open as.
Analyse and Play are disabled while the position is invalid and describe
themselves with the reason.

The editor opens `/analysis#fen=…` through `analysisLink` and
`/play?fen=…`; the play page reads its start position from the `fen` query
parameter (`FEN_QUERY_PARAM`), and the editor itself opens on
`/editor?fen=…`, which the analysis page links to for the current position.
Both links carry the normalised FEN.

### The Engines page

`src/routes/engines/+page.svelte` renders one `PinRow` per row of a
`PinManager` (`src/lib/pins/pin-manager.ts`), which sits on the runtime's
shared `PinStore` and memoised catalogue and publishes an immutable
`PinManagerState`: the rows (`PinStore.list`, catalogue pins first, then the
stale entries), the total from `usage()`, and the default pin from
`getDefaultPin`, so a stored id the catalogue has retired shows the first pin
as the default. Every download and delete ends with a fresh `list` and
`usage`; a generation counter keeps an older listing from overwriting a newer
one.

The manager overlays its own download progress on the listed state. Each
download it follows gets a progress record, and only the record currently
held for that pin may report progress, set an error or clear the overlay. A
delete during a download drops the record, so the row returns to "not
downloaded" at once, while the store cancels the transfer, and the transfer's
late `missing` rejection is ignored rather than shown; downloading again
starts a new record. A listing that reports a download this manager did not
start (the analysis page began it in the same tab) is joined through
`PinStore.download`, which shares the in-flight transfer, so its progress
keeps moving here.

A failed download shows its message on the row. `QuotaExceededError` asks
the user to delete versions on this page, while the analysis page's message
points here. The page states that browsers may clear the storage (Safari after
seven days without a visit) and never promises that a download is kept.

A stale entry is deleted through `PinStore.delete(id)`, which removes every
cache entry for that id.

### Local serving and the end-to-end tests

`vite.config.ts` adds the middleware from `scripts/local-serving.ts` to both
the dev and the preview server; it
sends COOP `same-origin`, COEP `require-corp` and CORP `same-origin`, and
serves `/engines/pins.json` and `/engines/<id>/avalanche.wasm` from
`build-pins/out/engines` (override with `AVALANCHE_PINS_DIR`).
A pin that cannot be read answers 500 instead of leaving the request hanging.
`AVALANCHE_ISOLATION=off` drops the isolation headers. Playwright starts two
preview servers from one build: the isolated one on `E2E_PORT` (default 4173)
for every test, and a non-isolated one on the next port for the refusal test. The engine tests need the pin
built first (`scripts/build-pins.sh build-pins/out`, which CI runs before the
e2e step). The clipboard tests replace `navigator.clipboard.writeText` with a
recorder, since WebKit grants Playwright no clipboard permission.
Playwright's WebKit drops Cache Storage when an ephemeral context reloads the
page, so the stale pin test, which must reload with the pin still cached,
runs in a persistent context (`launchPersistentContext` on a temporary
profile) in both browsers.

## Play vs Avalanche

`src/routes/play/+page.svelte` wires the board, `GamePanel` and `SetupDialog`
to one `PlayController` (`src/lib/play/controller.ts`). Like the analysis
controller it is plain TypeScript that publishes an immutable `PlayState`
(`idle`, `starting`, `playing`, `over`) with a tree `revision`.

### Setup and the engine

The dialog picks the side (a `random` side is resolved once, when the game
starts, and stored as `userColor`), the start through `StartPositionPicker`,
the pin, the strength, the time control (`src/lib/play/setup.ts`: the five
presets or a custom 0.25–180 minutes plus 0–180 s), an optional per-move
limit (`movetime`, `depth` or `nodes`), Hash, Threads and Ponder. While it is
open the page probes the chosen pin and Hash through the shared
`EngineSessionCache`, downloading the pin first, so the Elo slider can span
the pin's advertised `UCI_Elo` range and Threads is offered only when the
pin's `threadsMax` is above 1. The probe holds no lease: the analysis
controller only exists on its own page, and the probe asks the cache for the
same key the game will use, so starting the game reuses that worker.

`start(settings)` acquires the `play` lease, which suspends any analysis
lease, and connects once: with `{ hashMb, threads }` when the settings ask for
more than one thread (the dialog only offers that when the probed pin's
`threadsMax` is above 1), else with `{ hashMb }`. A saved game asking for more
threads than its pin now allows fails at the host's `threadsMax` check, which
runs before any `setoption Threads`, so Threads is never sent to a
single-threaded pin and no second worker is booted. It then
sends `ucinewgame`, resets `MultiPV` to 1 (the analysis board may have raised
it on the same worker), sets `UCI_Chess960` for an FRC start, and either
`UCI_LimitStrength true` with the clamped `UCI_Elo`, or `UCI_LimitStrength
false` with `UCI_Elo` back at the pin's default for full strength, and
`Ponder`. The lease is released when the game ends and when the page is left.

Each engine search is `position fen <root> moves …` followed by `go` with
`wtime`, `btime`, `winc` and `binc` read from the clock at that moment, plus
the per-move limit when one is set. The engine's own time is sent
`ENGINE_TIME_MARGIN_MS` (100 ms) short, never below 1 ms: the page charges the
engine from the user's press until the `bestmove` message arrives, which
includes the worker round trip that the engine's own timer cannot see. Every change that makes a search stale
(the user's takeback, resignation, a flag, a new game) bumps a generation
counter and stops the search; a `bestmove` from an older generation is never
played. The engine's last `multipv 1` score for each of its moves is kept, in
the engine's own point of view, for the draw offer: one entry per engine move,
`null` for a move that came with no score, so a takeback removes exactly the
entries of the moves it removes. The offer is accepted when the last ten
entries are all scores and `drawOfferAccepted` accepts them. An engine move that arrives after its flag fell is refused and the
game is lost on time.

With Ponder on, after the engine's move the controller sends `position` with
the expected reply appended and `go ponder` with the clock fields. If the user
plays that reply the controller sends `ponderhit` and waits for the same
search's `bestmove`; any other move stops the ponder search, whose result is
ignored, and starts a normal search on the real position.

A premove is held by the controller and tried the moment the engine's move
has been applied, as queen promotion when the plain move is illegal; an
illegal premove is dropped. The page cancels chessground's premove highlight
whenever the controller's premove is cleared.

Takeback is allowed once the user has moved. On the user's turn it removes the
engine's reply and the user's move; while the engine thinks it removes the
user's move and stops the search. The clocks keep their times and the user's
clock runs again. Every position after a move goes through `adjudicate`
against the game's earlier positions, so checkmate, stalemate, insufficient
material, the fifty-move rule and threefold repetition end the game whoever
moved.

### The clock

`createClock` (`src/lib/play/clock.ts`) keeps each side's stored time and the
timestamp from which the running side is charged, and computes the remaining
time from the `MonotonicNow` it is given (`performance.now()` on the page).
Nothing is decremented by timer ticks: the page's 100 ms interval and the
`visibilitychange` handler only call `tick()`, which checks `flagged(now)`.
A background tab whose timers were throttled therefore still charges the full
elapsed time the moment it returns, and a flag falls at the right time.
`start(side)` on a running clock charges the old side and switches without an
increment; `press()` charges, adds the increment and switches.

### Persistence

`src/lib/play/persist.ts` stores a `SavedGame` under `avalanche-play-v1`:
version `1`, the setup (settings, `userColor`, `startedAt`), the main line as
UCI moves, a clock snapshot, the engine's scores and the result. The
controller saves after every move, takeback and result, and the page also
saves on `visibilitychange` to hidden and on `pagehide` so a reload keeps the
time used since the last move. Loading validates the whole shape: the version, the settings (a per-move
limit within `ENGINE_LIMIT_MAX`: one hour of movetime, depth 128, ten billion
nodes, the same bounds the dialog enforces), an ISO `startedAt`, the moves,
which must replay from the start, a clock whose running side is the side to
move (or none), and none once there is a result, the scores and the result.
Anything else, including unparsable JSON or another version, is removed and
treated as no game. A stored Hash that this device does not offer is clamped
to the largest choice below it, or the smallest choice. Every storage call is wrapped,
so a throwing or absent `localStorage` means no persistence rather than an
error. On load a finished game is shown with its result; an unfinished one
reconnects the engine and restores the clock, charging the side to move from
that moment on, since no one was playing while the page was closed.

### Starting from a link

`/play?fen=<FEN>` (the editor's "Play from here") opens the setup dialog with
that position in the picker's FEN field, and removes the parameter from the
address with SvelteKit's `replaceState`, so a later reload resumes the game
rather than reopening the setup. An invalid FEN shows the parser's message in
the picker and leaves the standard start selected. A saved game is not
resumed while the linked setup is open and is not discarded either: starting
the new game replaces it, and closing the dialog without starting resumes it.

### Afterwards

`pgn()` exports the main line with the seven-tag roster (`You` against
`Avalanche <pin id>`), `TimeControl`, the engine's Elo when limited,
`Termination`, and the result token; `exportPgn` adds `Variant`, `SetUp` and
`FEN` for an FRC start. `downloadPgn()` saves it as
`avalanche-<YYYY-MM-DD>.pgn` (the game's start date, in UTC) through
`src/lib/shared/save-file.ts`, a `Blob` URL on a temporary link.

"Analyse this game" hands the PGN over in `sessionStorage` under
`avalanche-analysis-handoff` (`src/lib/shared/analysis-handoff.ts`) and
navigates to `/analysis`, whose page takes the entry once on mount, removes
it, imports it through `importPgn` like a paste, loads the game and moves to
its last position. `sessionStorage` is per tab, so the handoff never leaks
into another tab, and it avoids a URL size limit that a `#pgn=` link would
hit on a long game. When the browser refuses the write, the play page stays
where it is and says so, pointing at the PGN download.

### End-to-end notes

`tests/e2e/play.spec.ts` plays a 1+0 game as White against a 300-node engine,
choosing moves with chessops from the page's FEN and a seeded picker, until a
result appears, then follows the handoff into the analysis board. The reload
test runs in a persistent context for the same Cache Storage reason as the
stale pin test above.
