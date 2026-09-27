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
| `npm run test:e2e` | Playwright against a production build, Chromium and WebKit |
| `npm run build` | static build into `build/` |

CI runs the same five checks on every push to `main` and every pull request.

## License

GPL-3.0-only. See [`LICENSE`](LICENSE).
