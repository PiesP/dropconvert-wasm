# External Runtime Assets

This app downloads some assets at runtime that are not installed as npm dependencies in this repository.

## FFmpeg Core Assets (WASM)

The app fetches the multi-threaded FFmpeg core bundle from unpkg at runtime:

- **Package:** `@ffmpeg/core-mt@0.12.6`
- **Source:** https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/esm/
- **Files:**
  - `ffmpeg-core.js` — FFmpeg API wrapper
  - `ffmpeg-core.wasm` — WebAssembly binary
  - `ffmpeg-core.worker.js` — Web Worker for multi-threading

### Licensing

The licensing of the FFmpeg core bundle is **complex and important**:

1. **Wrapper License (`@ffmpeg/core-mt`):**

   - Licensed under **MIT**
   - Maintained by the ffmpeg.wasm project

2. **FFmpeg Binary Licensing (CRITICAL):**

   - FFmpeg is licensed under **LGPLv2.1** and **GPLv2+** depending on components
   - The exact license depends on which **optional features and encoders** are compiled into the bundle
   - Builds may include GPL-licensed components (x264, libx265, etc.) if enabled
   - You **must review FFmpeg's legal page** and the license files in the bundle you distribute

3. **Your Obligations:**
   - If the bundle includes **GPL-licensed code**, you must comply with GPL terms (source availability)
   - Provide proper attribution and license notices to your users
   - Review https://ffmpeg.org/legal.html before distribution

### Upstream Projects

- **ffmpeg.wasm:** https://github.com/ffmpegwasm/ffmpeg.wasm
- **FFmpeg:** https://ffmpeg.org/

### Recommended Actions

- Download and inspect the actual `ffmpeg-core.wasm` bundle to verify its license compliance
- Include FFmpeg's license in your deployment if required by its license type
- Ensure your terms of service/privacy policy acknowledge these dependencies
