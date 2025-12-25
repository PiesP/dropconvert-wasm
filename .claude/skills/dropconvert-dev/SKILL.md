---
name: dropconvert-dev
description: Develop and maintain the dropconvert-wasm Vite + React + TypeScript app (Cloudflare Pages + ffmpeg.wasm).
allowed-tools: Read Bash(git:*) Bash(pnpm:*)
---

# dropconvert-wasm Development Skill

Use this skill when the user asks to:

- Implement UI/UX features in the SPA
- Fix conversion issues with ffmpeg.wasm
- Improve Cloudflare Pages compatibility (COOP/COEP, SharedArrayBuffer)
- Debug build/lint/typecheck failures

## Non-negotiables

- Code/comments/docs: English only.
- No server upload: conversions happen in-browser.
- Keep COOP/COEP headers:
  - `public/_headers`
  - `vite.config.ts` (`server.headers`, `preview.headers`)
- Load ffmpeg core assets from CDN via `toBlobURL()`.

## Verification

Run at least:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm build`
