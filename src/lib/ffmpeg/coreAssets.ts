import { toBlobURL } from '@ffmpeg/util';

export type CoreAssets = {
  coreURL: string;
  wasmURL: string;
  workerURL: string;
};

// NOTE: The multi-threaded core package provides the worker file.
// @ffmpeg/core@0.12.6 (single-thread) does not ship ffmpeg-core.worker.js under dist/esm.
const CORE_BASE_URL = 'https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/esm';

let coreAssetsPromise: Promise<CoreAssets> | null = null;

export async function getCoreAssets(): Promise<CoreAssets> {
  if (coreAssetsPromise) return coreAssetsPromise;

  coreAssetsPromise = (async () => {
    const coreURL = await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.js`, 'text/javascript');
    const wasmURL = await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.wasm`, 'application/wasm');
    const workerURL = await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.worker.js`, 'text/javascript');
    return { coreURL, wasmURL, workerURL };
  })().catch((err) => {
    // Allow retry after transient network errors.
    coreAssetsPromise = null;
    throw err;
  });

  return coreAssetsPromise;
}
