# Contributing

Thanks for your interest in contributing to **dropconvert-wasm**.

This repository is a Cloudflare Pages-ready **Vite + SolidJS + TypeScript** SPA. The default product flow converts a single image into a short MP4/GIF entirely **in the browser** using **ffmpeg.wasm**. An optional batch queue can be enabled with `VITE_FEATURE_BATCH=1` when you need to work on that code path.

## Where to communicate

- **Bug reports / feature requests:** GitHub Issues
- **Security & privacy issues:** follow `.github/SECURITY.md`

If GitHub Discussions are enabled for this repo, feel free to use them for questions and ideas.

## Before opening an issue

Please check:

- `README.md` → Troubleshooting
- Existing issues (duplicates)

### Bug reports: include diagnostics

To make issues actionable, please include:

- Browser + version
- OS + device type (desktop/mobile/tablet)
- What you expected vs what happened
- Repro steps (exact clicks/inputs)
- Console output (if possible)
- `SharedArrayBuffer` availability
- `crossOriginIsolated` status
- Exported debug info (if the engine status card offered **Export Debug Info**)

Example snippet to run in DevTools console:

```js
({
  sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
  crossOriginIsolated,
});
```

**Important:** do not attach sensitive files or private information.

## Development setup

### Prerequisites

- Node.js 22.16+ locally (see `package.json` `engines`; CI currently runs Node 24)
- pnpm 10.26.1

### Install

- `pnpm install`

### Run locally

- `pnpm dev`

This project relies on **cross-origin isolation** to enable ffmpeg.wasm multi-threading.
Local dev/preview headers are configured in `vite.config.ts`.
Optional build-time env flags are documented in `README.md`.

### Quality checks

Before opening a PR, please run:

- `pnpm quality`
- `pnpm build`

If you changed dependencies or license-related files, keep `public/licenses/third-party-licenses*.json` in sync. `pnpm build` does this automatically.

## Project constraints (must keep)

- **No server upload:** user files must stay local.
- **SharedArrayBuffer:** requires COOP/COEP headers.
  - Cloudflare Pages: `public/_headers`
  - Local dev/preview: `vite.config.ts`
- ffmpeg core assets are downloaded from a CDN at runtime (see `src/lib/ffmpeg/coreAssets.ts`).
- The default UX is single-image conversion. Batch queue changes should remain behind `VITE_FEATURE_BATCH=1` unless you intentionally change the product default.

## Code style

- Source code, comments, and documentation are **English only**.
- Keep diffs small and focused.
- Prefer explicit loading/progress/error states.
- If you add a new build-time env flag, document it in `README.md` and declare it in `src/vite-env.d.ts`.

## License

By contributing, you agree that your contributions will be licensed under the project license (see `LICENSE`).
