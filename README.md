# DropConvert (dropconvert-wasm)

**Live demo:** https://dropconvert-wasm.pages.dev/

DropConvert turns images into short **MP4** and **GIF** files entirely **in your browser** using **ffmpeg.wasm**.

- No server uploads: your files stay local.
- First run may download ~30 MB of FFmpeg core assets from unpkg, then reuse the browser cache.

## Features

- Single-image conversion flow by default.
- Optional experimental batch queue (up to 20 images) via `VITE_FEATURE_BATCH=1`.
- MP4 and GIF outputs with preview and download.
- Engine status card with first-run download progress, cached-load status, retry, cancel, reset, and debug export actions.
- Validation warnings with saved per-browser warning preferences.
- Partial-result handling: keep a successful MP4 even if GIF generation fails, with a retry action for GIF.
- Cloudflare Pages-ready COOP/COEP setup for `SharedArrayBuffer`.

## Requirements (`SharedArrayBuffer`)

ffmpeg.wasm multi-threading requires **cross-origin isolation**:

- `SharedArrayBuffer` support
- `crossOriginIsolated === true`
- COOP/COEP headers

Cloudflare Pages is supported via `public/_headers` (copied to `dist/_headers` on build). Local dev and preview use matching headers from `vite.config.ts`.

## FFmpeg core assets

The app loads the multi-thread core bundle (`@ffmpeg/core-mt@0.12.6`) from **unpkg** at runtime and converts the downloaded assets to blob URLs before loading FFmpeg.

## Development

### Requirements

- Node.js 22.16+ locally (`package.json` `engines`; CI currently runs Node 24)
- pnpm 10.26.1

### Common commands

```bash
pnpm install
pnpm dev
pnpm quality
pnpm build
pnpm preview
```

`pnpm build` runs `pnpm licenses:generate` first, which refreshes `public/licenses/third-party-licenses*.json`.

## Optional build-time environment variables

These Vite env vars are optional. A normal Cloudflare Pages deployment does **not** require any environment variables.

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `VITE_FEATURE_BATCH` | unset | Enables the experimental batch queue UI (up to 20 images). |
| `VITE_DEBUG_FFMPEG` | unset | Enables verbose FFmpeg debug logs in development. |
| `VITE_DEBUG_APP` | unset | Enables additional app-level debug logs in development. |
| `VITE_FFMPEG_HARD_TIMEOUT_MS` | `15000` in dev / `60000` in production builds | Overrides the hard execution timeout used by the conversion pipeline. |

If you choose to set any of these on Cloudflare Pages, configure them as build-time environment variables in the project settings.

## Troubleshooting

### `SharedArrayBuffer` or `crossOriginIsolated` is missing

Run this in the browser console:

```js
({
  sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
  crossOriginIsolated,
});
```

If either value is false:

- Make sure you are serving the app with the configured COOP/COEP headers.
- Check `public/_headers` (Cloudflare Pages) and `vite.config.ts` (local dev/preview).
- Try a compatible desktop browser if a mobile browser blocks `SharedArrayBuffer`.

### The first load is slow

The first conversion downloads the FFmpeg core bundle. Wait for the engine status card to finish downloading and initializing. Later conversions should reuse cached assets when the browser cache is available.

### MP4 succeeded but GIF failed

Large images can exhaust browser memory during GIF encoding. Try these steps:

- Use the built-in **Retry GIF Conversion** action.
- Resize the input image before converting.
- Close other tabs and background apps.
- Prefer a desktop browser for larger images.

### The engine shows an error

If the engine status card offers **Export Debug Info**, save that file and include its relevant details when filing a bug report. The engine status card also exposes **Reset Engine** and **Cancel Conversion** actions for recovery.

## Support

- **Questions / usage help:** use GitHub Discussions if they are enabled for this repository; otherwise open an issue with clear context.
- **Bug reports:** use the Bug Report template and include reproduction steps, browser/device info, `SharedArrayBuffer` diagnostics, console output, and exported debug info when available.
- **Feature requests:** use the Feature Request template.
- **Security or privacy issues:** follow [.github/SECURITY.md](.github/SECURITY.md).

## Deployment (Cloudflare Pages)

- Build command: `pnpm build`
- Output directory: `dist/`
- Keep `public/_headers` in the repository; Vite copies it to `dist/_headers`.
- No environment variables are required for the default deployment.

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
