# Avalanche Web

A public, static, lichess-style interface to the
[Avalanche](https://github.com/SnowballSH/Avalanche) chess engine. The engine
runs in the visitor's browser as WebAssembly; the server serves static files
and nothing else.

Design notes live in [`docs/architecture.md`](docs/architecture.md).

## Stack

Svelte 5, SvelteKit with `adapter-static`, Foundation UI on Tailwind CSS v4,
strict TypeScript, Biome, Vitest and Playwright.

## Develop

```sh
npm ci
npx playwright install chromium webkit
npm run dev
```

| Script | What it does |
| --- | --- |
| `npm run check` | `svelte-kit sync` and `svelte-check`, warnings fail |
| `npm run lint` | Biome formatting, lint and import-order check |
| `npm run format` | apply Biome's safe fixes |
| `npm test` | Vitest unit tests in `tests/unit` |
| `npm run test:integration` | the real engine wasm in a Node worker thread; needs `scripts/fetch-fixture-wasm.sh` (Zig 0.16.0) once, or `AVALANCHE_FIXTURE_WASM` pointing at a built pin |
| `npm run test:e2e` | Playwright against a production build, Chromium and WebKit |
| `npm run test:e2e:served` | Playwright against the built container image, served by `scripts/serve-image.sh` |
| `npm run build` | static build into `build/` |

CI runs the same five checks on every push, to any branch, and every pull request,
then builds every pin with Zig 0.16.0 (`scripts/build-pins.sh`, cached on the
catalogue and build scripts), gates each build on the recorded ABI, and runs the
integration tests against the built pin. A second job builds the container
image and runs the served-image suite against it; on `main` the tested image
is published to `ghcr.io/snowballsh/avalanche-web`. Pins are documented in
[`docs/pins.md`](docs/pins.md), the image in [`docs/image.md`](docs/image.md).

## License

GPL-3.0-only. See [`LICENSE`](LICENSE).
