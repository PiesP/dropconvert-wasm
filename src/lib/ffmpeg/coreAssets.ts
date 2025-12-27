import { toBlobURL } from '@ffmpeg/util';

export type CoreAssets = {
  coreURL: string;
  wasmURL: string;
  workerURL: string;
};

export type DownloadProgress = {
  loaded: number;
  total: number;
  percent: number;
};

export type ProgressCallback = (progress: DownloadProgress) => void;

// NOTE: The multi-threaded core package provides the worker file.
// @ffmpeg/core@0.12.6 (single-thread) does not ship ffmpeg-core.worker.js under dist/esm.
const CORE_BASE_URL = 'https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/esm';

// Approximate file sizes and weights for progress calculation
const FILE_WEIGHTS = {
  'ffmpeg-core.js': 0.08, // ~8% of total
  'ffmpeg-core.wasm': 0.9, // ~90% of total
  'ffmpeg-core.worker.js': 0.02, // ~2% of total
};

let coreAssetsPromise: Promise<CoreAssets> | null = null;
let currentProgressCallback: ProgressCallback | null = null;

/**
 * Download a file with progress tracking and convert it to a blob URL.
 */
async function downloadWithProgress(
  url: string,
  mimeType: string,
  filename: string,
  onProgress?: ProgressCallback
): Promise<string> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${filename}: ${response.statusText}`);
  }

  const contentLength = Number(response.headers.get('content-length')) || 0;
  const reader = response.body?.getReader();

  if (!reader) {
    // Fallback to toBlobURL if streaming is not supported
    console.warn('[coreAssets] Streaming not supported, falling back to toBlobURL');
    return toBlobURL(url, mimeType);
  }

  const chunks: Uint8Array[] = [];
  let receivedLength = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) break;

    chunks.push(value);
    receivedLength += value.length;

    if (onProgress && contentLength > 0) {
      // Calculate this file's contribution to total progress
      const fileProgress = receivedLength / contentLength;
      const weight = FILE_WEIGHTS[filename as keyof typeof FILE_WEIGHTS] || 0;
      onProgress({
        loaded: receivedLength,
        total: contentLength,
        percent: fileProgress * weight,
      });
    }
  }

  // Concatenate chunks into a single Uint8Array
  const data = new Uint8Array(receivedLength);
  let position = 0;
  for (const chunk of chunks) {
    data.set(chunk, position);
    position += chunk.length;
  }

  // Create blob URL
  const blob = new Blob([data], { type: mimeType });
  return URL.createObjectURL(blob);
}

/**
 * Aggregate progress tracker for multiple file downloads.
 */
class ProgressAggregator {
  private progress: Map<string, number> = new Map();
  private callback: ProgressCallback;

  constructor(callback: ProgressCallback) {
    this.callback = callback;
  }

  update(filename: string, percent: number) {
    this.progress.set(filename, percent);

    // Sum up all weighted progress
    const total = Array.from(this.progress.values()).reduce((sum, val) => sum + val, 0);

    this.callback({
      loaded: total * 100, // Approximate loaded bytes (percentage-based)
      total: 100,
      percent: Math.min(total, 1), // Clamp to 1.0
    });
  }
}

export async function getCoreAssets(onProgress?: ProgressCallback): Promise<CoreAssets> {
  // If there's an ongoing download with a different progress callback, don't reuse the promise
  if (coreAssetsPromise && currentProgressCallback === onProgress) {
    return coreAssetsPromise;
  }

  currentProgressCallback = onProgress ?? null;

  coreAssetsPromise = (async () => {
    const aggregator = onProgress ? new ProgressAggregator(onProgress) : null;

    const createProgressCallback = (filename: string): ProgressCallback | undefined => {
      return aggregator ? (progress) => aggregator.update(filename, progress.percent) : undefined;
    };

    const [coreURL, wasmURL, workerURL] = await Promise.all([
      downloadWithProgress(
        `${CORE_BASE_URL}/ffmpeg-core.js`,
        'text/javascript',
        'ffmpeg-core.js',
        createProgressCallback('ffmpeg-core.js')
      ),
      downloadWithProgress(
        `${CORE_BASE_URL}/ffmpeg-core.wasm`,
        'application/wasm',
        'ffmpeg-core.wasm',
        createProgressCallback('ffmpeg-core.wasm')
      ),
      downloadWithProgress(
        `${CORE_BASE_URL}/ffmpeg-core.worker.js`,
        'text/javascript',
        'ffmpeg-core.worker.js',
        createProgressCallback('ffmpeg-core.worker.js')
      ),
    ]);

    return { coreURL, wasmURL, workerURL };
  })().catch((err) => {
    // Allow retry after transient network errors.
    coreAssetsPromise = null;
    currentProgressCallback = null;
    throw err;
  });

  return coreAssetsPromise;
}
