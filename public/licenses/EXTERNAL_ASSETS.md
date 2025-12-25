# External runtime assets

This app downloads some assets at runtime that are not installed as npm dependencies in this repository.

## ffmpeg core assets (WASM)

The app fetches the multi-threaded ffmpeg core bundle from unpkg:

- Package: `@ffmpeg/core-mt@0.12.6`
- Base URL: https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/esm/
- Files:
  - `ffmpeg-core.js`
  - `ffmpeg-core.wasm`
  - `ffmpeg-core.worker.js`

Licensing notes:

- The npm package `@ffmpeg/core-mt` declares the **MIT** license.
- The WASM bundle includes **FFmpeg**. FFmpeg's licensing can vary depending on how it is built (LGPL/GPL, optional components).
  Please review FFmpeg's legal page and the license files shipped with the core bundle you distribute or reference.
  - https://ffmpeg.org/legal.html

Upstream project:

- https://github.com/ffmpegwasm/ffmpeg.wasm
