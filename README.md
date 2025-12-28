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

AdSense integration is managed via environment variables:

1. **Copy `.env.example` to `.env`:**
   ```bash
   cp .env.example .env
   ```

2. **Configure your publisher ID:**
   ```env
   VITE_ADSENSE_PUBLISHER_ID=ca-pub-YOUR-PUBLISHER-ID
   VITE_ENABLE_ADS=true
   ```

3. **Disable ads in development** (optional):
   ```env
   VITE_ENABLE_ADS=false
   ```

4. **Update `public/ads.txt`** with your publisher ID:
   ```
   google.com, pub-YOUR-PUBLISHER-ID, DIRECT, f08c47fec0942fa0
   ```

5. **Site Verification** (if required by Google AdSense):
   - Download the verification HTML file from AdSense dashboard
   - Place it in `public/` directory (e.g., `public/6960758ac10d902328ef5e618c3da67f00953324.html`)
   - Vite will automatically copy it to `dist/` during build

The AdSense script is injected into `index.html` at build time via Vite's HTML transform plugin. When `VITE_ENABLE_ADS=false`, the script tags are replaced with HTML comments.

## Deployment (Cloudflare Pages)

- Build command: `pnpm build`
- Output directory: `dist/` (includes `_headers`)

### Environment Variables on Cloudflare Pages

Set these environment variables in your Cloudflare Pages project settings:

| Variable | Value | Required |
|----------|-------|----------|
| `VITE_ADSENSE_PUBLISHER_ID` | `ca-pub-YOUR-PUBLISHER-ID` | Yes (if using AdSense) |
| `VITE_ENABLE_ADS` | `true` | Yes (if using AdSense) |

Go to: **Cloudflare Dashboard → Pages → Your Project → Settings → Environment Variables**

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
