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

const EXPECTED_FILES = Object.keys(FILE_WEIGHTS) as Array<keyof typeof FILE_WEIGHTS>;

let coreAssetDataPromise: Promise<CoreAssetData> | null = null;
const progressListeners = new Set<ProgressCallback>();
let lastAggregateProgress: DownloadProgress = { loaded: 0, total: 0, percent: 0 };

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

  if (!reader) {
    // Fallback to arrayBuffer when streaming is not supported.
    console.warn('[coreAssets] Streaming not supported, falling back to arrayBuffer');
    const buffer = await response.arrayBuffer();
    const data: Uint8Array<ArrayBuffer> = new Uint8Array(buffer);
    onProgress?.({ loaded: data.byteLength, total: data.byteLength, percent: 1 });
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
      const fileProgress = receivedLength / contentLength;
      onProgress({
        loaded: receivedLength,
        total: contentLength,
        percent: fileProgress,
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
    percent: 1,
  });

  return data;
}

/**
 * Aggregate progress tracker for multiple file downloads.
 */
class ProgressAggregator {
  private progress: Map<string, DownloadProgress> = new Map();
  private callback: ProgressCallback;

  constructor(callback: ProgressCallback) {
    this.callback = callback;
  }

  update(filename: string, progress: DownloadProgress) {
    this.progress.set(filename, progress);

    const entries = Array.from(this.progress.entries());
    const loadedBytes = entries.reduce(
      (sum, [, p]) => sum + (Number.isFinite(p.loaded) ? p.loaded : 0),
      0
    );
    const totalBytes = entries.reduce(
      (sum, [, p]) => sum + (Number.isFinite(p.total) ? p.total : 0),
      0
    );

    const hasAllTotals =
      EXPECTED_FILES.every((f) => {
        const p = this.progress.get(f);
        return p && Number.isFinite(p.total) && p.total > 0;
      }) && totalBytes > 0;

    const percent = (() => {
      if (hasAllTotals) {
        return Math.max(0, Math.min(1, loadedBytes / totalBytes));
      }

      // Fallback when totals are unknown: use weighted per-file progress.
      let weighted = 0;
      for (const f of EXPECTED_FILES) {
        const p = this.progress.get(f);
        if (!p) continue;
        const perFile = p.total > 0 ? p.loaded / p.total : p.percent;
        weighted += Math.max(0, Math.min(1, perFile)) * FILE_WEIGHTS[f];
      }
      return Math.max(0, Math.min(1, weighted));
    })();

    this.callback({ loaded: loadedBytes, total: totalBytes, percent });
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
        return (progress) => aggregator.update(filename, progress);
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

      const totalBytes = coreData.byteLength + wasmData.byteLength + workerData.byteLength;
      emitProgress({ loaded: totalBytes, total: totalBytes, percent: 1 });
      return { coreData, wasmData, workerData };
    })().catch((err) => {
      // Allow retry after transient network errors.
      coreAssetDataPromise = null;
      emitProgress({ loaded: 0, total: 0, percent: 0 });
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
