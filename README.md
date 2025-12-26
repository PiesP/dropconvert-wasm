# DropConvert (dropconvert-wasm)

**Live demo:** https://dropconvert-wasm.pages.dev/

Convert **one image** into a short **MP4** and **GIF** entirely **in your browser** using **ffmpeg.wasm**.

- No server uploads (your file stays local).
- First run may download ~30MB of ffmpeg core assets from a CDN (cached by the browser).

## Features

- Single-image dropzone (PNG/JPEG/WebP/etc.)
- Outputs:
  - MP4 (H.264-compatible settings)
  - GIF (palette-based encoding)
- Progress, preview, and download

## Requirements (SharedArrayBuffer)

ffmpeg.wasm multi-threading requires **cross-origin isolation**:

- `SharedArrayBuffer` support
- `crossOriginIsolated === true`
- COOP/COEP headers

Cloudflare Pages is supported via `public/_headers` (copied to `dist/_headers` on build). Local dev/preview uses the same headers via `vite.config.ts`.

## ffmpeg core assets

The app loads the multi-thread core bundle (`@ffmpeg/core-mt@0.12.6`) from **unpkg** at runtime using `toBlobURL()`.

## Development

- Prereqs: Node.js 22+ and pnpm 10.26
- Install: `pnpm install`
- Dev: `pnpm dev`
- Build: `pnpm build`
- Preview: `pnpm preview`

## Deployment (Cloudflare Pages)

- Build command: `pnpm build`
- Output directory: `dist/` (includes `_headers`)

## Links

- Issues / support: https://github.com/PiesP/dropconvert-wasm/issues/new/choose
- Licenses (deployed): https://dropconvert-wasm.pages.dev/licenses/
- ffmpeg.wasm: https://github.com/ffmpegwasm/ffmpeg.wasm

## License

MIT. See `LICENSE` and the deployed licenses page.

---

<div align="center">

**🌟 If you find this project useful, please give it a Star! 🌟**

**Made with ❤️ and GitHub Copilot by [PiesP](https://github.com/PiesP)**

</div>
