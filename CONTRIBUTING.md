# Contributing

Thanks for your interest in contributing to **dropconvert-wasm**.

This repository is a Cloudflare Pages-ready **Vite + React + TypeScript** SPA that converts a single image into a short MP4/GIF entirely **in the browser** using **ffmpeg.wasm**.

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
- Console output (if possible), including:

  - `SharedArrayBuffer` availability
  - `crossOriginIsolated` status

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

- Node.js 22+ (see `package.json` `engines`)
- pnpm 10.26

### Install

- `pnpm install`

### Run locally

- `pnpm dev`

This project relies on **cross-origin isolation** to enable ffmpeg.wasm multi-threading.
Local dev/preview headers are configured in `vite.config.ts`.

### Quality checks

Before opening a PR, please run:

- `pnpm lint`
- `pnpm fmt:check`
- `pnpm typecheck`
- `pnpm build`

## Project constraints (must keep)

- **No server upload:** user files must stay local.
- **SharedArrayBuffer:** requires COOP/COEP headers.
  - Cloudflare Pages: `public/_headers`
  - Local dev/preview: `vite.config.ts`
- ffmpeg core assets are downloaded from a CDN at runtime (see `src/lib/ffmpeg/coreAssets.ts`).

## Code style

- Source code, comments, and documentation are **English only**.
- Keep diffs small and focused.
- Prefer explicit loading/progress/error states.

## License

By contributing, you agree that your contributions will be licensed under the project license (see `LICENSE`).
