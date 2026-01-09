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

### Environment Variables on Cloudflare Pages

Set these environment variables in your Cloudflare Pages project settings:

| Variable | Value | Required |
| -------- | ----- | -------- |

Go to: **Cloudflare Dashboard → Pages → Your Project → Settings → Environment Variables**

## Links

- Issues / support: https://github.com/PiesP/dropconvert-wasm/issues/new/choose
- Licenses (deployed): https://dropconvert-wasm.pages.dev/licenses/
- ffmpeg.wasm: https://github.com/ffmpegwasm/ffmpeg.wasm

## License & Attribution

**dropconvert-wasm** is released under the **MIT License**. See [LICENSE](LICENSE) for the full text.

### Third-Party Dependencies

All production dependencies are under permissive licenses (MIT). See [public/licenses/](public/licenses/) for:

- Complete third-party license information
- Detailed breakdown by license type
- Attribution for all packages

### FFmpeg Licensing (Important ⚠️)

This project uses **FFmpeg** via `@ffmpeg/ffmpeg` (MIT wrapper) and downloads the **FFmpeg WASM binary** from a CDN at runtime.

**⚠️ FFmpeg's licensing is complex:**

- The FFmpeg binary itself is under **LGPLv2.1 or GPLv2+** depending on the build configuration
- Optional encoders like x264, x265, and libmp3lame can make the entire bundle GPL-licensed
- If you deploy this app, you **must** review and comply with FFmpeg's licensing requirements

**Before deploying to production:**

1. Review [FFmpeg's Legal Page](https://ffmpeg.org/legal.html)
2. Check the license files in the downloaded FFmpeg WASM bundle
3. Ensure your deployment and licensing strategy aligns with FFmpeg's requirements
4. Consider including FFmpeg's license notices in your deployment

**Resources:**

- [FFmpeg Legal](https://ffmpeg.org/legal.html)
- [ffmpeg.wasm on GitHub](https://github.com/ffmpegwasm/ffmpeg.wasm)
- [public/licenses/EXTERNAL_ASSETS.md](public/licenses/EXTERNAL_ASSETS.md) — Detailed FFmpeg asset documentation

---

<div align="center">

**🌟 If you find this project useful, please give it a Star! 🌟**

**Made with ❤️ and GitHub Copilot by [PiesP](https://github.com/PiesP)**

</div>
