Developer: # GitHub Copilot Instruction

This repository is **dropconvert-wasm**: a Cloudflare Pages-ready **Vite + React + TypeScript** SPA.
It converts a single image into a short MP4 or GIF entirely **in the browser** using **ffmpeg.wasm**.

## Language Requirements

- Source code, comments, and documentation: **English only**.
- Copilot Chat explanations/summaries: **Korean**.
- Commit messages: **English**, conventional commits.

## Project Constraints (Core)

- **No server upload**: conversion must run locally in the browser.
- **SharedArrayBuffer**: ffmpeg.wasm multithreading requires **cross-origin isolation**.
  - Cloudflare Pages: configure `public/_headers` with COOP/COEP.
  - Local dev: configure `vite.config.ts` `server.headers` and `preview.headers`.
- **ffmpeg core from CDN**: load `ffmpeg-core.js/.wasm/.worker.js` from unpkg using `toBlobURL()` (use `@ffmpeg/core-mt` so the worker file exists).
- Prefer small, targeted diffs; keep UI responsive and clearly state loading/progress/error states.

## Workflow Expectations

- For complex tasks: propose a brief spec and a minimal test/verification plan first.
- Validate by running (at least): `pnpm lint`, `pnpm typecheck`, `pnpm build`.

## UI Expectations

- Single-image dropzone with validation.
- Distinct states: loading (first run may download ~30MB), converting (progress), done (preview + download).
- Warn when `SharedArrayBuffer` or `crossOriginIsolated` is unavailable (common on some mobile browsers).
