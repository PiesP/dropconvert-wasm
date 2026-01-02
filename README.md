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

### Google AdSense Configuration

AdSense integration is fully managed via environment variables. **No hard-coded IDs in the repository.**

1. **Copy `.env.example` to `.env`:**

   ```bash
   cp .env.example .env
   ```

2. **Configure your publisher ID:**

   ```env
   VITE_ADSENSE_PUBLISHER_ID=ca-pub-YOUR-PUBLISHER-ID
   VITE_ENABLE_ADS=true
   ```

3. **Build or run dev server:**

   - `public/ads.txt` is **automatically generated** from the environment variables
   - The AdSense script is injected into `index.html` at build time
   - When `VITE_ENABLE_ADS=false`, ads are completely disabled

4. **Site Verification** (if required by Google AdSense):
   - Download the verification HTML file from AdSense dashboard
   - Place it in `public/` directory (e.g., `public/6960758ac10d902328ef5e618c3da67f00953324.html`)
   - Vite will automatically copy it to `dist/` during build

**⚠️ For Forkers:** This repository does **not** include real AdSense IDs. If you fork this project, you must configure your own publisher ID in your local `.env` file or Cloudflare Pages environment variables.

## Deployment (Cloudflare Pages)

- Build command: `pnpm build`
- Output directory: `dist/` (includes `_headers`)

### Environment Variables on Cloudflare Pages

Set these environment variables in your Cloudflare Pages project settings:

| Variable                    | Value                      | Required               |
| --------------------------- | -------------------------- | ---------------------- |
| `VITE_ADSENSE_PUBLISHER_ID` | `ca-pub-YOUR-PUBLISHER-ID` | Yes (if using AdSense) |
| `VITE_ENABLE_ADS`           | `true`                     | Yes (if using AdSense) |

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
