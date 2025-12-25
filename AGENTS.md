# AGENTS.md

AI coding guidance for **dropconvert-wasm**.

This repository is a **Cloudflare Pages-ready** single-page application (SPA) built with **Vite + React + TypeScript**.
Its main feature is **in-browser** image → short MP4/GIF conversion using **ffmpeg.wasm**.

## Stack

- React 18
- TypeScript 5.9
- Vite 7
- Tailwind CSS 3
- ffmpeg.wasm (`@ffmpeg/ffmpeg` 0.12.x + `@ffmpeg/util`)
- Biome 2.3
- Node.js 24.12 (Volta) + pnpm 10.26

## Repository Structure

- `src/` — React SPA source
- `public/` — static assets (must include `public/_headers` for Cloudflare Pages)
- `vite.config.ts` — dev/preview headers for local cross-origin isolation

## Core Constraints

- **No server upload**: all conversions happen locally in the browser.
- **SharedArrayBuffer requirements**: ffmpeg.wasm multithreading requires cross-origin isolation.
  - Cloudflare Pages: configure `public/_headers` with COOP/COEP.
  - Local dev: configure `vite.config.ts` `server.headers`.
- **ffmpeg core from CDN**: use `toBlobURL()` to load `ffmpeg-core.js/.wasm/.worker.js` from unpkg (use `@ffmpeg/core-mt` so the worker file exists).
- Source code and comments: **English only**.
- Commit messages: **English**, conventional commits.

## Commands

- `pnpm dev` — Vite dev server
- `pnpm build` — production build (`dist/`)
- `pnpm preview` — preview production build
- `pnpm lint` / `pnpm lint:fix` — Biome lint
- `pnpm fmt` / `pnpm fmt:check` — Biome format
- `pnpm typecheck` — TypeScript (no emit)
- `pnpm quality` — lint + format check + typecheck

## Cloudflare Pages Notes

- Ensure `public/_headers` is present; Vite will copy it to `dist/_headers`.
- Required headers:
  - `Cross-Origin-Embedder-Policy: require-corp`
  - `Cross-Origin-Opener-Policy: same-origin`

## UI/UX Expectations

- Single-file dropzone (image-only) with clear validation messages.
- Explicit states: loading (first run downloads ~30MB), converting (progress), done (preview + download).
- Warn when `SharedArrayBuffer` or `crossOriginIsolated` is unavailable.
