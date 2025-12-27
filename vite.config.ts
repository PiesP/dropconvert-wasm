// vite.config.ts

import type { PluginOption } from 'vite';
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import { visualizer } from 'rollup-plugin-visualizer';

const securityHeaders: Record<string, string> = {
  // Required for SharedArrayBuffer (ffmpeg.wasm multi-threading)
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

export default defineConfig({
  plugins: [
    solidPlugin(),
    // Bundle analysis: generates dist/stats.html to visualize bundle composition
    visualizer({
      filename: 'dist/stats.html',
      open: false, // Don't auto-open in browser
      gzipSize: true,
      brotliSize: true,
      template: 'treemap', // Options: treemap, sunburst, network
    }) as PluginOption,
  ],
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
