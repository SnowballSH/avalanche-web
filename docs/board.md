# Board and evaluation components

`src/lib/board/` wraps lichess's chessground for the analysis board and the
play page, and renders the evaluation bar and graph. The engine and the game
tree never touch chessground; the pages pass a FEN and a set of legal
destinations in and receive UCI moves out.

## chessground

The package is `@lichess-org/chessground`, the scoped successor of
`chessground`, which npm marks deprecated. It is GPL-3.0-or-later, the same
family as this repository. Its `assets/` stylesheets are imported from
`Board.svelte`, so Vite bundles them same-origin: the board texture and every
piece are `data:` SVG URIs inside the CSS, which the site's
`img-src 'self' data:` policy permits, and nothing loads from a CDN.

`board.css` sits on top of those stylesheets and maps the interactive
highlights (selected square, last move, move destinations) and the coordinate
font to Foundation UI tokens. The wood colours stay lichess brown and the
pieces keep their own black and white, since those are the board's palette
rather than the site's theme. Biome does not know chessground's custom
element names (`cg-board`, `square`, `piece`), so `noUnknownTypeSelector` is
off for that one file.

## Board.svelte

Props: `fen`, `orientation`, `movable` (`{ color, dests }`), `lastMove` (a
UCI move), `check`, `shapes` (engine arrows, applied as chessground auto
shapes), `premovable`, `chess960` and `coordinates`. Callbacks: `onmove(uci)`,
`onpremove(uci | null)` (null when the premove is cleared) and
`onshapes(shapes)` for the user's own right-click arrows and circles. The
component exports `playPremove()` and `cancelPremove()` for the play
controller.

The parent supplies the destinations with `legalDests(fen, chess960)` from
`moves.ts`, which wraps chessops' `chessgroundDests`. In standard chess the
map carries both castling representations, so the user can drag the king two
squares or onto the rook; in Chess960 it carries king-onto-rook only, which is
how UCI encodes castling under `UCI_Chess960`. Either way `moveUci` runs the
dropped squares through `moveToUci` in `src/lib/chess/fen.ts`, so the emitted
move is `e1g1` in standard chess and `e1h1` in Chess960 whichever square the
king was dropped on. If `movable.color` is not the side to move, the board
gets an empty destination map, so a stale `dests` from the parent can never
let the wrong side move.

Chessground clears its destinations and flips its turn colour as soon as a
piece is dropped. The board therefore re-applies the position and the
movable configuration whenever the parent's props change, and also when the
parent leaves `fen` unchanged after `onmove` (the move was refused) or when a
promotion is cancelled. Re-sending `fen` to chessground clears the user's
drawn shapes, so the sync omits `fen` when it has not changed.

A pawn dropped on the last rank does not emit a move. The board opens
`PromotionPicker`, a column of four buttons over the destination file that
stacks inward from the edge, and emits `e7e8q`-style moves on a pick; Escape
or a click on the backdrop cancels and restores the pawn. A premove that
promotes is played as a queen, since the picker cannot interrupt a premove.
The picker shares chessground's `cg-wrap` class so that the piece-set
stylesheet draws its pieces.

Bounds are read lazily by chessground and refreshed on a window `resize`
event only, so the wrapper watches its own element with a `ResizeObserver`
and dispatches `chessground.resize` when the layout changes without the
window.

## Scores

`SearchInfo.score` is from the side to move, as UCI reports it. `EvalBar`
and `EvalGraph` take scores from White's point of view, and `eval.ts`
provides `toWhitePov(score, turn)` and `whitePovAt(fen, score)` to convert
at the node whose position was searched.

`whiteWinChance` is lichess's curve, `2 / (1 + e^(-0.00368208 cp)) - 1`,
clamped to [-1, 1], with any mate as ±1. `evalBarFraction` maps it onto the
bar and clamps centipawn scores to [0.05, 0.95] so a sliver of the losing
colour always remains, while a mate fills the bar. `formatScore` renders
`+1.23`, `0.00`, `#4` and `-#4`.

`EvalGraph` draws one column per entry of `scores` (index 0 is the start
position, index n is after ply n), fills the white share from the bottom, and
overlays one button per column so a click or a keyboard activation calls
`onselect(index)`. A missing score keeps the previous value so the curve has
no holes.

## Development harness

`src/routes/dev/board/` renders the components with a position picker, a
Chess960 toggle, a flip button and `<output>` logs of every callback, for
`tests/e2e/board.spec.ts`. The route only exists in a build made with
`BOARD_HARNESS=1`: `vite.config.ts` turns that variable into the
`__BOARD_HARNESS__` constant, the page's `load` answers 404 without it and
the page only imports `Harness.svelte` behind it, so a production build
carries neither the harness nor its chunk. `playwright.config.ts` sets the
variable for its build; the container image does not.

## Piece set licence

The pieces are Colin M.L. Burnett's "cburnett" set as embedded in
`@lichess-org/chessground/assets/chessground.cburnett.css`. Wikimedia Commons
(for example `File:Chess_klt45.svg`) offers the set under the GNU GPL 2 or
later, the GNU Free Documentation License 1.2 or later, the Creative Commons
Attribution-ShareAlike 3.0 Unported licence and the 3-clause BSD licence, at
the user's option; lichess's `COPYING.md` records its own use under GPLv2+.
This project uses the set under GPLv2 or later, which the site's GPL-3.0
licence satisfies, and credits Colin M.L. Burnett as the author.
