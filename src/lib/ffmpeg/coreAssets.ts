export type CoreAssets = {
  coreURL: string;
  wasmURL: string;
  workerURL: string;
};

export type CoreAssetData = {
  coreData: Uint8Array<ArrayBuffer>;
  wasmData: Uint8Array<ArrayBuffer>;
  workerData: Uint8Array<ArrayBuffer>;
};

export type CoreAssetsWithData = CoreAssets & CoreAssetData;

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

let coreAssetDataPromise: Promise<CoreAssetData> | null = null;
const progressListeners = new Set<ProgressCallback>();
let lastAggregateProgress: DownloadProgress = { loaded: 0, total: 100, percent: 0 };

function emitProgress(progress: DownloadProgress) {
  lastAggregateProgress = progress;
  for (const listener of progressListeners) {
    try {
      listener(progress);
    } catch {
      // Ignore listener errors.
    }
  }
}

export function revokeCoreAssets(assets: CoreAssets | null | undefined): void {
  if (!assets) return;

  try {
    URL.revokeObjectURL(assets.coreURL);
  } catch {
    // Ignore.
  }
  try {
    URL.revokeObjectURL(assets.wasmURL);
  } catch {
    // Ignore.
  }
  try {
    URL.revokeObjectURL(assets.workerURL);
  } catch {
    // Ignore.
  }
}

/**
 * Download a file with progress tracking and convert it to a blob URL.
 */
async function downloadWithProgress(
  url: string,
  filename: string,
  onProgress?: ProgressCallback
): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${filename}: ${response.statusText}`);
  }

  const contentLength = Number(response.headers.get('content-length')) || 0;
  const reader = response.body?.getReader();
  const weight = FILE_WEIGHTS[filename as keyof typeof FILE_WEIGHTS] || 0;

  if (!reader) {
    // Fallback to arrayBuffer when streaming is not supported.
    console.warn('[coreAssets] Streaming not supported, falling back to arrayBuffer');
    const buffer = await response.arrayBuffer();
    const data: Uint8Array<ArrayBuffer> = new Uint8Array(buffer);
    onProgress?.({ loaded: data.byteLength, total: data.byteLength, percent: weight });
    return data;
  }

  const chunks: Array<Uint8Array<ArrayBuffer>> = [];
  let receivedLength = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) break;

    chunks.push(value as Uint8Array<ArrayBuffer>);
    receivedLength += value.length;

    if (onProgress && contentLength > 0) {
      // Calculate this file's contribution to total progress
      const fileProgress = receivedLength / contentLength;
      onProgress({
        loaded: receivedLength,
        total: contentLength,
        percent: fileProgress * weight,
      });
    }
  }

  // Concatenate chunks into a single Uint8Array
  const data: Uint8Array<ArrayBuffer> = new Uint8Array(receivedLength);
  let position = 0;
  for (const chunk of chunks) {
    data.set(chunk, position);
    position += chunk.length;
  }

  // Ensure we emit a final 100% update for this file.
  onProgress?.({
    loaded: receivedLength,
    total: contentLength > 0 ? contentLength : receivedLength,
    percent: weight,
  });

  return data;
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

export async function getCoreAssets(onProgress?: ProgressCallback): Promise<CoreAssetsWithData> {
  if (onProgress) {
    progressListeners.add(onProgress);
    try {
      onProgress(lastAggregateProgress);
    } catch {
      // Ignore.
    }
  }

  if (!coreAssetDataPromise) {
    coreAssetDataPromise = (async () => {
      const aggregator = new ProgressAggregator(emitProgress);

      const createProgressCallback = (filename: string): ProgressCallback => {
        return (progress) => aggregator.update(filename, progress.percent);
      };

      const [coreData, wasmData, workerData] = await Promise.all([
        downloadWithProgress(
          `${CORE_BASE_URL}/ffmpeg-core.js`,
          'ffmpeg-core.js',
          createProgressCallback('ffmpeg-core.js')
        ),
        downloadWithProgress(
          `${CORE_BASE_URL}/ffmpeg-core.wasm`,
          'ffmpeg-core.wasm',
          createProgressCallback('ffmpeg-core.wasm')
        ),
        downloadWithProgress(
          `${CORE_BASE_URL}/ffmpeg-core.worker.js`,
          'ffmpeg-core.worker.js',
          createProgressCallback('ffmpeg-core.worker.js')
        ),
      ]);

      emitProgress({ loaded: 100, total: 100, percent: 1 });
      return { coreData, wasmData, workerData };
    })().catch((err) => {
      // Allow retry after transient network errors.
      coreAssetDataPromise = null;
      emitProgress({ loaded: 0, total: 100, percent: 0 });
      throw err;
    });
  }

  if (onProgress) {
    void coreAssetDataPromise.finally(() => {
      progressListeners.delete(onProgress);
    });
  }

  const data = await coreAssetDataPromise;

  // Create fresh blob URLs per call so callers can safely revoke them.
  const coreURL = URL.createObjectURL(new Blob([data.coreData], { type: 'text/javascript' }));
  const wasmURL = URL.createObjectURL(new Blob([data.wasmData], { type: 'application/wasm' }));
  const workerURL = URL.createObjectURL(new Blob([data.workerData], { type: 'text/javascript' }));

  return {
    coreURL,
    wasmURL,
    workerURL,
    ...data,
  };
}
