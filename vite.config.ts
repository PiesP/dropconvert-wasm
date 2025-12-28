// vite.config.ts

import type { Plugin, PluginOption } from 'vite';
import { defineConfig, loadEnv } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import { visualizer } from 'rollup-plugin-visualizer';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const securityHeaders: Record<string, string> = {
  // Required for SharedArrayBuffer (ffmpeg.wasm multi-threading)
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

// HTML transform plugin for injecting AdSense code conditionally
function htmlTransformPlugin(env: Record<string, string>): Plugin {
  return {
    name: 'html-transform',
    transformIndexHtml(html) {
      const enableAds = env.VITE_ENABLE_ADS === 'true';
      const publisherId = env.VITE_ADSENSE_PUBLISHER_ID || '';

      let transformed = html;

      if (enableAds && publisherId) {
        // Inject AdSense meta tag
        const metaTag = `<meta name="google-adsense-account" content="${publisherId}">`;
        transformed = transformed.replace('%%ADSENSE_META%%', metaTag);

        // Inject AdSense script
        const scriptTag = `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${publisherId}" crossorigin="anonymous"></script>`;
        transformed = transformed.replace('%%ADSENSE_SCRIPT%%', scriptTag);
      } else {
        // Remove placeholders in development
        transformed = transformed.replace('%%ADSENSE_META%%', '<!-- AdSense disabled -->');
        transformed = transformed.replace('%%ADSENSE_SCRIPT%%', '<!-- AdSense disabled -->');
      }

      return transformed;
    },
  };
}

// Plugin to dynamically generate public/ads.txt from environment variables
function generateAdsTxtPlugin(env: Record<string, string>): Plugin {
  return {
    name: 'generate-ads-txt',
    buildStart() {
      const enableAds = env.VITE_ENABLE_ADS === 'true';
      const publisherId = env.VITE_ADSENSE_PUBLISHER_ID || '';

      // Only generate ads.txt if ads are enabled and publisher ID is set
      if (enableAds && publisherId && !publisherId.includes('XXXX')) {
        const publicDir = join(process.cwd(), 'public');
        const adsTxtPath = join(publicDir, 'ads.txt');

        // Extract numeric ID from ca-pub-XXXXXXXXXXXXXXXX
        const numericId = publisherId.replace('ca-pub-', '');
        const adsTxtContent = `google.com, pub-${numericId}, DIRECT, f08c47fec0942fa0\n`;

        try {
          mkdirSync(publicDir, { recursive: true });
          writeFileSync(adsTxtPath, adsTxtContent, 'utf-8');
          console.log(`✓ Generated public/ads.txt with publisher ID: ${publisherId}`);
        } catch (error) {
          console.warn(`⚠ Failed to generate ads.txt:`, error);
        }
      } else {
        console.log('ℹ Skipping ads.txt generation (ads disabled or placeholder ID)');
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [
      solidPlugin(),
      htmlTransformPlugin(env),
      generateAdsTxtPlugin(env),
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
  };
});
