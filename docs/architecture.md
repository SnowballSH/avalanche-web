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
