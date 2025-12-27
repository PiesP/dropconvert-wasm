// vite.config.ts

import solidPlugin from 'vite-plugin-solid';
import { defineConfig } from 'vite';

const securityHeaders: Record<string, string> = {
  // Required for SharedArrayBuffer (ffmpeg.wasm multi-threading)
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

export default defineConfig({
  plugins: [solidPlugin()],
  // Vite dependency pre-bundling can break @ffmpeg/ffmpeg's internal worker URL rewriting
  // (it may point to a non-existent /node_modules/.vite/deps/worker.js). Excluding it keeps
  // the worker module resolvable in dev.
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg'],
  },
  server: {
    headers: securityHeaders,
  },
  preview: {
    headers: securityHeaders,
  },
});
