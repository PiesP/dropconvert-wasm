# dropconvert-wasm

A Cloudflare Pages-ready **Vite + React + TypeScript** single-page app that converts **one image** into a very short **MP4** or **GIF** entirely **in the browser** using **ffmpeg.wasm**.

- No server upload (your file stays local).
- First run may download ~30MB of ffmpeg core assets from a CDN.

## Features

- Drag & drop a single image (PNG/JPEG/WebP/etc.)
- Convert to:
  - MP4 (1s, H.264-compatible settings)
  - GIF (1s, ffmpeg palette-based encoding, no loop)
- Progress + clear loading/error states
- Preview + download the result

## Requirements

This app uses ffmpeg.wasm multi-threading for both MP4 and GIF conversion, which requires
**SharedArrayBuffer** and therefore **cross-origin isolation**.

- Browser must support `SharedArrayBuffer`.
- Page must be `crossOriginIsolated === true`.
- COOP/COEP headers must be present.

### Cloudflare Pages (production)

This repo includes `public/_headers` so Pages can serve the required headers:

- `Cross-Origin-Embedder-Policy: require-corp`
- `Cross-Origin-Opener-Policy: same-origin`

Vite copies `public/_headers` to `dist/_headers` on build.

### Local dev / preview

`vite.config.ts` sets the same headers for `pnpm dev` and `pnpm preview`.

## ffmpeg core assets

The app loads ffmpeg core assets from **unpkg** at runtime using `toBlobURL()`.
This project uses the multi-thread core bundle (`@ffmpeg/core-mt`) so the worker file is available.

- `https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/esm/ffmpeg-core.js`
- `https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/esm/ffmpeg-core.wasm`
- `https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/esm/ffmpeg-core.worker.js`

## Development

### Prerequisites

- Node.js 22+ (see `package.json` `engines`)
- pnpm 10.26

### Install

- `pnpm install`

### Run

- `pnpm dev`

### Build

- `pnpm build`

### Preview production build

- `pnpm preview`

## Deployment notes (Cloudflare)

### Cloudflare Pages

For a standard Pages project, you typically only need:

- Build command: `pnpm build`
- Build output directory: `dist`

Pages will publish the `dist/` directory automatically. You generally should **not** run `wrangler deploy` from a Pages build.

If you see an error like:

> Missing entry-point to Worker script or to assets directory

it usually means the project is being deployed as a **Worker** (Wrangler) instead of a **Pages** site.

## Troubleshooting

### “SharedArrayBuffer not available” / `crossOriginIsolated` is false

- Ensure COOP/COEP headers are being served.
  - Cloudflare Pages: confirm `public/_headers` exists in the repo and `dist/_headers` exists after build.
  - Local dev: use `pnpm dev` (Vite dev server adds headers via `vite.config.ts`).
- Try a desktop Chromium-based browser.
  - Some mobile browsers disable SharedArrayBuffer.

### Conversion is slow on first run

This is expected: ffmpeg core assets are downloaded from the CDN on first load.

## Support & contributing

- Questions / ideas: GitHub Discussions (if enabled) or open an issue.
- Bug reports: open an issue using the Bug Report template.
- Feature requests: open an issue using the Feature Request template.
- Security or privacy issues: see `.github/SECURITY.md`.
- Contributing guide: see `CONTRIBUTING.md`.

## Security & privacy

- Conversion runs locally in your browser.
- The app is designed to avoid uploading files to a server.
- ffmpeg core assets are downloaded from a CDN (unpkg) at runtime.

## License

- Project license: **MIT** (see `LICENSE`).
- Third-party dependency licenses: published under `public/licenses/` and available in the deployed site at `/licenses/`.
  - External runtime assets (downloaded from CDN at runtime): `public/licenses/EXTERNAL_ASSETS.md`
  - Production/runtime dependencies: `public/licenses/third-party-licenses.prod.json`
  - Dev-only dependencies: `public/licenses/third-party-licenses.dev.json`
  - All installed dependencies: `public/licenses/third-party-licenses.all.json`

To refresh the third-party license lists after changing dependencies:

- `pnpm licenses:generate`
