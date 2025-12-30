// useFFmpeg.ts

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import { createMemo, createSignal } from 'solid-js';
import {
  type ConversionMetadata,
  collectSystemInfo,
  type DebugInfo,
} from '../lib/debug/debugExporter';
import {
  type CacheableAssetData,
  getCachedAssets,
  isIndexedDBAvailable,
  setCachedAssets,
} from '../lib/ffmpeg/cacheManager';
import { type DownloadProgress, getCoreAssets, revokeCoreAssets } from '../lib/ffmpeg/coreAssets';
import { isFfmpegNotLoadedError, isLikelyWasmAbort, toErrorMessage } from '../lib/ffmpeg/errors';
import { inferImageExtension, inferSafeBaseName } from '../lib/ffmpeg/fileNames';
import {
  clamp01,
  fileDataToBytes,
  getImageDimensions,
  normalizeFfmpegTimeToSeconds,
  parseFfmpegLogTimeToSeconds,
  tryReadNonEmptyFile,
} from '../lib/ffmpeg/utils';
import {
  preprocessImage,
  transcodeAVIFToPNG,
  transcodeWebPToPNG,
} from '../lib/preprocessing/canvasPreprocessor';
import {
  canPreprocessInWorker,
  preprocessFileInWorker,
} from '../lib/preprocessing/workerPreprocessor';

export type ConvertFormat = 'mp4' | 'gif';

export type ConvertResult = {
  url: string;
  mimeType: string;
  filename: string;
};

export type ConvertResults = {
  mp4: ConvertResult | null;
  gif: ConvertResult | null;
};

export type ConvertImageOptions = {
  // Optional metadata from prior validation to avoid redundant decoding.
  metadata?: {
    width: number;
    height: number;
    format?: string;
    mimeType?: string;
  };

  // Optional decoded bitmap from validation.
  // When provided, it will be reused for canvas downscaling to avoid a second decode.
  // Ownership is transferred to the converter (it will be closed).
  decodedBitmap?: ImageBitmap;
};

export type FFmpegStage =
  | 'idle'
  | 'preprocessing'
  | 'loading'
  | 'ready'
  | 'writing'
  | 'running'
  | 'reading'
  | 'finalizing';

export type SharedArrayBufferSupport = {
  hasSAB: boolean;
  isIsolated: boolean;
  supported: boolean;
};

export type EngineErrorCode =
  | 'download-timeout'
  | 'init-timeout'
  | 'exec-timeout'
  | 'wasm-abort'
  | 'not-loaded'
  | 'worker-terminated'
  | 'unknown';

// Core-level timeout forwarded into ffmpeg-core via `ffmpeg.setTimeout(timeout)`.
// The unit is implementation-defined in the core build, so we disable it and rely on a JS watchdog.
const CORE_TIMEOUT = -1;

// JS-level watchdog to recover from cases where the core never returns.
const HARD_TIMEOUT_MS = (() => {
  const override = Number(import.meta.env.VITE_FFMPEG_HARD_TIMEOUT_MS);
  if (Number.isFinite(override) && override > 0) return override;
  return import.meta.env.DEV ? 15_000 : 60_000;
})();

// Loading the core may include a ~30MB download on first run.
// Use generous timeouts, but still fail with a clear message instead of hanging forever.
const ASSET_DOWNLOAD_TIMEOUT_MS = import.meta.env.DEV ? 45_000 : 180_000;
const CORE_INIT_TIMEOUT_MS = import.meta.env.DEV ? 30_000 : 90_000;

function getRuntimeDebugFlag(key: 'app' | 'ffmpeg'): boolean {
  // Allow toggling verbose logs without restarting Vite.
  // Usage (DevTools console): localStorage.setItem('dropconvert.debug.ffmpeg', '1')
  //                          localStorage.setItem('dropconvert.debug.app', '1')
  //                          location.reload()
  if (typeof window === 'undefined') return false;
  try {
    const v = window.localStorage.getItem(`dropconvert.debug.${key}`);
    return v === '1' || v === 'true';
  } catch {
    return false;
  }
}

const DEBUG_FFMPEG_LOGS =
  import.meta.env.DEV &&
  (import.meta.env.VITE_DEBUG_FFMPEG === '1' || getRuntimeDebugFlag('ffmpeg'));
const DEBUG_APP_LOGS =
  import.meta.env.DEV && (import.meta.env.VITE_DEBUG_APP === '1' || getRuntimeDebugFlag('app'));

function debugApp(...args: unknown[]): void {
  if (!DEBUG_APP_LOGS) return;
  // Use debug to keep the default console noise low.
  console.debug(...args);
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });
}

const MAX_RECENT_FFMPEG_LOGS = 200;

function toExactArrayBuffer(data: Uint8Array<ArrayBuffer>): ArrayBuffer {
  // Ensure we store only the used byte range (avoid retaining a larger backing buffer).
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

function formatArgsForLog(args: string[], maxLen = 600): string {
  const joined = args.join(' ');
  if (joined.length <= maxLen) return joined;
  return `${joined.slice(0, maxLen)}…(+${joined.length - maxLen} chars)`;
}

function isInterestingFfmpegLog(message: string): boolean {
  const m = message.trim();
  if (!m) return false;
  if (m === 'Aborted()') return false;

  // Common banner + build info.
  if (m.startsWith('ffmpeg version ')) return false;
  if (m.startsWith('configuration:')) return false;
  if (m.startsWith('built with ')) return false;
  if (m.startsWith('libav')) return false;
  if (m.startsWith('  libav')) return false;

  // Typical per-run info / progress spam.
  if (m.startsWith('Input #')) return false;
  if (m.startsWith('Stream mapping:')) return false;
  if (m.startsWith('Output #')) return false;
  if (m.startsWith('frame=')) return false;
  if (m.startsWith('video:')) return false;
  if (m.startsWith('Last message repeated')) return false;

  // Very common and noisy when converting JPEG full-range input.
  if (m.includes('deprecated pixel format used')) return false;

  return true;
}

function getSharedArrayBufferSupport(): SharedArrayBufferSupport {
  const hasSAB = typeof SharedArrayBuffer !== 'undefined';
  const isIsolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated === true;
  return { hasSAB, isIsolated, supported: hasSAB && isIsolated };
}

export function useFFmpeg() {
  let ffmpegRef: FFmpeg | null = null;
  let didAttachListenersRef = false;
  let activeConvertRef = false;
  let convertTargetSecondsRef: number | null = null;
  let loadPromiseRef: Promise<void> | null = null;
  const recentFfmpegLogsRef: string[] = [];

  // AbortController for cancellation
  let abortControllerRef: AbortController | null = null;

  let execSeqRef = 0;
  let lastFfmpegLogRef: { atMs: number; message: string } | null = null;
  let lastProgressEventRef: {
    atMs: number;
    progress: number;
    time: string | number | null;
  } | null = null;
  let lastParsedFfmpegTimeRef: {
    atMs: number;
    seconds: number;
    source: 'log' | 'progress';
  } | null = null;

  const dumpRecentFfmpegLogs = (limit = 40): string => {
    const logs = recentFfmpegLogsRef;
    const tail = logs.slice(Math.max(0, logs.length - limit));
    return tail.join('\n');
  };

  const terminateAndReset = () => {
    const current = ffmpegRef;
    try {
      current?.terminate();
    } catch {
      // Ignore termination errors.
    }
    ffmpegRef = null;
    didAttachListenersRef = false;
    loadPromiseRef = null;
  };

  const execWithHardTimeout = async (
    ffmpeg: FFmpeg,
    args: string[],
    label: string,
    abortSignal?: AbortSignal
  ): Promise<number> => {
    let killed = false;
    const startedAt = performance.now();
    const execId = ++execSeqRef;
    const argsForLog =
      DEBUG_APP_LOGS || DEBUG_FFMPEG_LOGS ? args.join(' ') : formatArgsForLog(args);

    // Check if already cancelled before starting
    if (abortSignal?.aborted) {
      throw new Error('Conversion cancelled by user');
    }

    if (import.meta.env.DEV && (DEBUG_APP_LOGS || DEBUG_FFMPEG_LOGS)) {
      console.debug(`[ffmpeg][exec:start] #${execId} ${label}`, {
        args,
        argsString: argsForLog,
        argsCount: args.length,
      });
    }

    // Set up abort listener
    const abortListener = () => {
      killed = true;
      debugApp(`[ffmpeg][exec:cancelled] #${execId} ${label}`);
      terminateAndReset();
    };
    abortSignal?.addEventListener('abort', abortListener);

    const id = setTimeout(() => {
      killed = true;

      const elapsedMs = Math.round(performance.now() - startedAt);

      const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
      const hardwareConcurrency =
        typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : null;

      // Emit as much context as possible before terminating the worker.
      if (import.meta.env.DEV) {
        const recentLimit = DEBUG_FFMPEG_LOGS ? MAX_RECENT_FFMPEG_LOGS : 200;
        const recent = dumpRecentFfmpegLogs(recentLimit);
        const payload = {
          timeoutMs: HARD_TIMEOUT_MS,
          elapsedMs,
          sab: sab(),
          deviceMemory,
          hardwareConcurrency,
          loadedFromCache: loadedFromCache(),
          lastFfmpegLog: lastFfmpegLogRef,
          lastProgressEvent: lastProgressEventRef,
          lastParsedFfmpegTime: lastParsedFfmpegTimeRef,
          args,
          argsString: argsForLog,
          argsCount: args.length,
          recentLogsCount: recentFfmpegLogsRef.length,
        };

        // 1) Structured payload (easy to inspect).
        console.error(`[ffmpeg][exec:timeout] #${execId} ${label}`, payload);

        // 2) Plain strings (easy to copy/paste without expanding the object in DevTools).
        console.error(`[ffmpeg][exec:timeout] #${execId} ${label} argsString:\n${argsForLog}`);
        console.error(`[ffmpeg][exec:timeout] #${execId} ${label} recentLogs (tail):\n${recent}`);
      }

      terminateAndReset();
    }, HARD_TIMEOUT_MS);

    const execPromise = ffmpeg
      .exec(args, CORE_TIMEOUT)
      .catch((err) => {
        if (killed) return 1;
        throw err;
      })
      .finally(() => {
        clearTimeout(id);
        abortSignal?.removeEventListener('abort', abortListener);
      });

    const hardTimeoutPromise = new Promise<never>((_, reject) => {
      // If the timer fired, `killed` will be true and the worker will be terminated.
      const pollId = setInterval(() => {
        if (!killed) return;
        clearInterval(pollId);
        // Avoid unhandled rejection if the exec promise rejects after termination.
        void execPromise.catch(() => undefined);
        reject(new Error(`FFmpeg appears stuck during ${label}. Worker was terminated.`));
      }, 50);
    });

    const code = await Promise.race([execPromise, hardTimeoutPromise]);

    // The race can resolve with an exit code (e.g., 1) after we already killed the worker.
    // Treat that as a hard failure so callers can reload and retry deterministically.
    if (killed) {
      throw new Error(`FFmpeg appears stuck during ${label}. Worker was terminated.`);
    }

    if (import.meta.env.DEV && (DEBUG_APP_LOGS || DEBUG_FFMPEG_LOGS)) {
      const elapsedMs = Math.round(performance.now() - startedAt);
      console.debug(`[ffmpeg][exec:done] #${execId} ${label}`, { code, elapsedMs });
    }

    return code;
  };

  const [isLoading, setIsLoading] = createSignal(false);
  const [isLoaded, setIsLoaded] = createSignal(false);
  const [isConverting, setIsConverting] = createSignal(false);
  const [isCancelling, setIsCancelling] = createSignal(false);
  const [progress, setProgress] = createSignal(0);
  const [stage, setStage] = createSignal<FFmpegStage>('idle');
  const [error, setError] = createSignal<string | null>(null);
  const [hasAttemptedLoad, setHasAttemptedLoad] = createSignal(false);
  const [engineErrorCode, setEngineErrorCode] = createSignal<EngineErrorCode | null>(null);
  const [engineErrorContext, setEngineErrorContext] = createSignal<string | null>(null);
  const [downloadProgress, setDownloadProgress] = createSignal<DownloadProgress>({
    loaded: 0,
    total: 0,
    percent: 0,
  });
  const [loadedFromCache, setLoadedFromCache] = createSignal(false);

  // Throttle conversion progress updates to reduce render churn.
  let progressRafId: number | null = null;
  let pendingProgress: number | null = null;
  const setProgressThrottled = (next: number) => {
    const clamped = clamp01(next);
    pendingProgress = pendingProgress === null ? clamped : Math.max(pendingProgress, clamped);

    if (progressRafId !== null) return;
    progressRafId = requestAnimationFrame(() => {
      progressRafId = null;
      if (pendingProgress === null) return;
      const value = pendingProgress;
      pendingProgress = null;
      setProgress((p) => Math.max(p, value));
    });
  };

  const resetProgressThrottle = () => {
    if (progressRafId !== null) {
      cancelAnimationFrame(progressRafId);
      progressRafId = null;
    }
    pendingProgress = null;
  };

  // Throttle download progress updates to once per animation frame.
  let downloadProgressRafId: number | null = null;
  let pendingDownloadProgress: DownloadProgress | null = null;
  const setDownloadProgressThrottled = (next: DownloadProgress) => {
    pendingDownloadProgress = next;
    if (downloadProgressRafId !== null) return;
    downloadProgressRafId = requestAnimationFrame(() => {
      downloadProgressRafId = null;
      if (!pendingDownloadProgress) return;
      setDownloadProgress(pendingDownloadProgress);
      pendingDownloadProgress = null;
    });
  };

  const sab = createMemo(() => getSharedArrayBufferSupport());

  const load = async () => {
    debugApp('[useFFmpeg] load() called', {
      sabSupported: sab().supported,
      alreadyLoaded: ffmpegRef?.loaded,
    });

    // Used for UI messaging (distinguish initial idle from failed/terminated runs).
    setHasAttemptedLoad(true);

    if (!sab().supported) {
      const errorMsg =
        'SharedArrayBuffer is not available. This app requires cross-origin isolation (COOP/COEP) and a compatible browser.';
      console.error('[useFFmpeg]', errorMsg);
      setError(errorMsg);
      setIsLoading(false);
      setIsLoaded(false);
      setStage('idle');
      return;
    }

    // If already loaded, reflect that in state.
    if (ffmpegRef?.loaded) {
      debugApp('[useFFmpeg] Already loaded, returning early');
      setIsLoaded(true);
      setIsLoading(false);
      setStage('ready');
      return;
    }

    // De-dupe concurrent load calls.
    if (loadPromiseRef) {
      await loadPromiseRef;
      return;
    }

    setIsLoading(true);
    setStage('loading');
    setError(null);
    setEngineErrorCode(null);
    setEngineErrorContext(null);
    setDownloadProgress({ loaded: 0, total: 0, percent: 0 });

    const p = (async () => {
      let didTimeout = false;
      let isCurrentAttempt = true;

      const withTimeout = async <T>(
        promise: Promise<T>,
        timeoutMs: number,
        timeoutMessage: string,
        code: EngineErrorCode,
        context?: string
      ): Promise<T> => {
        let id: number | null = null;
        const timeout = new Promise<never>((_, reject) => {
          id = window.setTimeout(() => {
            didTimeout = true;
            setEngineErrorCode(code);
            setEngineErrorContext(context ?? null);
            reject(new Error(timeoutMessage));
          }, timeoutMs);
        });

        try {
          return await Promise.race([promise, timeout]);
        } finally {
          if (id !== null) {
            clearTimeout(id);
          }
        }
      };

      try {
        if (!ffmpegRef) {
          debugApp('[useFFmpeg] Creating new FFmpeg instance');
          ffmpegRef = new FFmpeg();
        } else {
          debugApp('[useFFmpeg] Reusing existing FFmpeg instance');
        }

        const ffmpeg = ffmpegRef;

        if (!didAttachListenersRef) {
          debugApp('[useFFmpeg] Attaching event listeners');
          didAttachListenersRef = true;

          ffmpeg.on('progress', ({ progress, time }) => {
            // NOTE: The library docs mention progress is accurate only when input/output lengths match.
            // For our "looped single image" conversions, `progress` may stay at 0, so we also use `time`.
            if (!activeConvertRef) return;

            const byProgress = Number.isFinite(progress) ? progress : NaN;
            const byTime = (() => {
              const target = convertTargetSecondsRef;
              if (!target || target <= 0) return NaN;
              const seconds = normalizeFfmpegTimeToSeconds(time);
              return seconds > 0 ? seconds / target : NaN;
            })();

            const next = clamp01(
              Number.isFinite(byProgress)
                ? Number.isFinite(byTime)
                  ? Math.max(byProgress, byTime)
                  : byProgress
                : Number.isFinite(byTime)
                  ? byTime
                  : 0
            );

            setProgressThrottled(next);

            lastProgressEventRef = {
              atMs: performance.now(),
              progress: next,
              time: typeof time === 'string' || typeof time === 'number' ? time : null,
            };

            const target = convertTargetSecondsRef;
            if (target && target > 0) {
              const seconds = normalizeFfmpegTimeToSeconds(time);
              if (seconds > 0) {
                lastParsedFfmpegTimeRef = {
                  atMs: performance.now(),
                  seconds,
                  source: 'progress',
                };
              }
            }
          });

          ffmpeg.on('log', ({ message }) => {
            // Keep recent logs for post-mortem debugging (timeouts, aborts, crashes).
            // Always store them (low overhead), but only print to console when debugging.
            const ring = recentFfmpegLogsRef;
            ring.push(message);
            if (ring.length > MAX_RECENT_FFMPEG_LOGS) {
              ring.splice(0, ring.length - MAX_RECENT_FFMPEG_LOGS);
            }

            lastFfmpegLogRef = { atMs: performance.now(), message };

            // Useful for debugging; keep it quiet by default (the raw output is very verbose).
            if (import.meta.env.DEV) {
              if (DEBUG_FFMPEG_LOGS || isInterestingFfmpegLog(message)) {
                console.debug('[ffmpeg]', message);
              }
            }

            // Some builds provide better timing info via logs than progress events.
            if (!activeConvertRef) return;
            const target = convertTargetSecondsRef;
            if (!target || target <= 0) return;

            const seconds = parseFfmpegLogTimeToSeconds(message);
            if (seconds === null) return;
            const next = clamp01(seconds / target);

            setProgressThrottled(next);

            lastParsedFfmpegTimeRef = {
              atMs: performance.now(),
              seconds,
              source: 'log',
            };
          });
        } else {
          debugApp('[useFFmpeg] Event listeners already attached');
        }

        debugApp('[useFFmpeg] Loading FFmpeg core assets...');

        // Cache-first strategy: check IndexedDB first, fallback to network
        const FFMPEG_VERSION = '0.12.6';
        const cacheAvailable = await isIndexedDBAvailable();
        let fromCache = false;
        let assets: { coreURL: string; wasmURL: string; workerURL: string };
        let assetsToRevoke: { coreURL: string; wasmURL: string; workerURL: string } | null = null;

        const onDownloadProgress = (next: DownloadProgress) => {
          if (!isCurrentAttempt) return;
          setDownloadProgressThrottled(next);
        };

        if (cacheAvailable) {
          debugApp('[useFFmpeg] Checking IndexedDB cache...');
          const cached = await getCachedAssets(FFMPEG_VERSION);

          if (cached) {
            debugApp('[useFFmpeg] Cache hit! Using cached assets');
            assets = cached;
            fromCache = true;
            assetsToRevoke = cached;
          } else {
            debugApp('[useFFmpeg] Cache miss, downloading from network...');
            const downloadedPromise = getCoreAssets(onDownloadProgress);
            const downloaded = await withTimeout(
              downloadedPromise,
              ASSET_DOWNLOAD_TIMEOUT_MS,
              'FFmpeg download timed out. Please check your connection and try again.',
              'download-timeout',
              'download'
            ).catch((err) => {
              // If the promise eventually resolves, ensure we revoke any blob URLs it created.
              void downloadedPromise.then((a) => revokeCoreAssets(a)).catch(() => undefined);
              throw err;
            });
            assets = downloaded;
            assetsToRevoke = downloaded;

            const cacheData: CacheableAssetData = {
              coreData: toExactArrayBuffer(downloaded.coreData),
              wasmData: toExactArrayBuffer(downloaded.wasmData),
              workerData: toExactArrayBuffer(downloaded.workerData),
            };

            // Try to cache the downloaded assets
            debugApp('[useFFmpeg] Caching assets for future use...');
            const cacheSuccess = await setCachedAssets(FFMPEG_VERSION, cacheData);
            if (cacheSuccess) {
              debugApp('[useFFmpeg] Assets cached successfully');
            } else {
              console.warn('[useFFmpeg] Failed to cache assets');
            }
          }
        } else {
          debugApp('[useFFmpeg] IndexedDB unavailable, downloading from network...');
          const downloadedPromise = getCoreAssets(onDownloadProgress);
          const downloaded = await withTimeout(
            downloadedPromise,
            ASSET_DOWNLOAD_TIMEOUT_MS,
            'FFmpeg download timed out. Please check your connection and try again.',
            'download-timeout',
            'download'
          ).catch((err) => {
            void downloadedPromise.then((a) => revokeCoreAssets(a)).catch(() => undefined);
            throw err;
          });
          assets = downloaded;
          assetsToRevoke = downloaded;
        }

        setLoadedFromCache(fromCache);
        debugApp('[useFFmpeg] Core assets ready, calling ffmpeg.load()');

        try {
          await withTimeout(
            ffmpeg.load(assets),
            CORE_INIT_TIMEOUT_MS,
            'FFmpeg initialization timed out. Please try again (reloading the page may help).',
            'init-timeout',
            'init'
          );
        } finally {
          // The core is fetched into the worker during load; revoke temporary blob URLs afterwards.
          revokeCoreAssets(assetsToRevoke);
        }

        debugApp('[useFFmpeg] FFmpeg core loaded successfully');
        setIsLoaded(true);
        setIsLoading(false);
        setProgress(0);
        setStage('ready');
        setError(null);
      } catch (err) {
        console.error('[useFFmpeg] Load error:', err);
        const message = err instanceof Error ? err.message : String(err);
        console.error('[useFFmpeg] Error message:', message);
        setIsLoading(false);
        setIsLoaded(false);
        setStage('idle');

        // Provide an extra hint on timeouts.
        if (didTimeout) {
          setError(
            `${message} If this keeps happening, try closing other tabs or using a desktop browser.`
          );
        } else {
          if (!engineErrorCode()) {
            setEngineErrorCode('unknown');
          }
          setError(message);
        }

        terminateAndReset();
        throw err;
      } finally {
        isCurrentAttempt = false;
        if (downloadProgressRafId !== null) {
          cancelAnimationFrame(downloadProgressRafId);
          downloadProgressRafId = null;
        }
        pendingDownloadProgress = null;
        loadPromiseRef = null;
      }
    })();

    loadPromiseRef = p;
    await p;
  };

  const convertImage = async (
    file: File,
    options?: ConvertImageOptions
  ): Promise<ConvertResults> => {
    // For a still image, we target a 1s MP4 at 1 fps.
    // Note: We intentionally keep the MP4 video-only for reliability.
    // Some lavfi-based silent audio sources have been observed to hang in wasm builds
    // (no Output/frames logs, never returning), so we prefer a simpler pipeline.
    const mp4Fps = 1;
    const mp4DurationSeconds = 1;
    const gifFps = 2;
    const gifDurationSeconds = 1;

    // Create AbortController for cancellation
    abortControllerRef = new AbortController();
    const { signal } = abortControllerRef;

    // MP4: 1-second clip from a looped still image. GIF: 1-second animation from a looped still image (no looping on playback).
    activeConvertRef = true;
    const gifFrameCount = Math.max(1, Math.round(gifFps * gifDurationSeconds));
    convertTargetSecondsRef = mp4DurationSeconds;

    setIsConverting(true);
    setIsCancelling(false);
    setProgress(0);
    setStage('loading');
    setError(null);
    setEngineErrorCode(null);
    setEngineErrorContext(null);

    // Phase 4: Canvas-based preprocessing for performance optimization
    let workingFile = file;
    let preprocessingApplied = false;

    const detectedFormat = options?.metadata?.format?.toLowerCase();
    const detectedMime = options?.metadata?.mimeType?.toLowerCase();
    const decodedBitmap = options?.decodedBitmap;

    const canUsePreprocessWorker = canPreprocessInWorker() && !decodedBitmap;
    const shouldUseWorkerForTranscode = (() => {
      if (!canUsePreprocessWorker) return false;

      // Avoid extra overhead for tiny images.
      const meta = options?.metadata;
      const maxSide = meta ? Math.max(meta.width, meta.height) : null;
      if (typeof maxSide === 'number' && Number.isFinite(maxSide) && maxSide >= 1600) return true;
      return file.size >= 1_000_000; // ~1MB
    })();

    try {
      setStage('preprocessing');
      setProgress(0.05);

      // Give the UI a chance to paint the new stage before heavy work.
      await nextFrame();

      // 1. WebP detection and PNG transcoding
      // WebP files are decoded slowly by FFmpeg's WebP decoder, so we transcode to PNG using Canvas
      const isWebP =
        detectedFormat === 'webp' ||
        detectedMime === 'image/webp' ||
        file.type === 'image/webp' ||
        file.name.toLowerCase().endsWith('.webp');
      const isAVIF =
        detectedFormat === 'avif' ||
        detectedMime === 'image/avif' ||
        file.type === 'image/avif' ||
        file.name.toLowerCase().endsWith('.avif');

      if (isWebP) {
        debugApp('[useFFmpeg] WebP detected, transcoding to PNG via Canvas API');
        const meta = options?.metadata;
        if (shouldUseWorkerForTranscode) {
          try {
            const out = await preprocessFileInWorker(
              file,
              {
                op: 'transcode-to-png',
                maxDimension: 2560,
                outputFormat: 'png',
                quality: 1.0,
                ...(meta ? { sourceWidth: meta.width, sourceHeight: meta.height } : {}),
              },
              signal
            );
            if (out) {
              workingFile = out;
              preprocessingApplied = true;
            }
          } catch (err) {
            if (signal.aborted) throw err;
            console.warn('[useFFmpeg] WebP worker preprocessing failed, falling back:', err);
          }
        }

        if (!preprocessingApplied) {
          workingFile = await transcodeWebPToPNG(
            file,
            meta
              ? { maxDimension: 2560, sourceWidth: meta.width, sourceHeight: meta.height }
              : { maxDimension: 2560 }
          );
          preprocessingApplied = true;
        }
      } else if (isAVIF) {
        try {
          debugApp('[useFFmpeg] AVIF detected, attempting transcoding to PNG via Canvas API');
          const meta = options?.metadata;
          if (shouldUseWorkerForTranscode) {
            try {
              const out = await preprocessFileInWorker(
                file,
                {
                  op: 'transcode-to-png',
                  maxDimension: 2560,
                  outputFormat: 'png',
                  quality: 1.0,
                  ...(meta ? { sourceWidth: meta.width, sourceHeight: meta.height } : {}),
                },
                signal
              );
              if (out) {
                workingFile = out;
                preprocessingApplied = true;
              }
            } catch (err) {
              if (signal.aborted) throw err;
              console.warn('[useFFmpeg] AVIF worker preprocessing failed, falling back:', err);
            }
          }

          if (!preprocessingApplied) {
            workingFile = await transcodeAVIFToPNG(
              file,
              meta
                ? { maxDimension: 2560, sourceWidth: meta.width, sourceHeight: meta.height }
                : { maxDimension: 2560 }
            );
            preprocessingApplied = true;
          }
        } catch (avifError) {
          if (signal.aborted) throw avifError;
          // If Canvas API can't decode AVIF (old browser), fall back to original file
          console.warn('[useFFmpeg] AVIF transcoding failed, using original file:', avifError);
          workingFile = file;
        }
      }

      // 2. Large image downscaling
      // Only apply if we didn't already transcode (to avoid double-processing)
      if (!preprocessingApplied) {
        const metadata = options?.metadata
          ? { width: options.metadata.width, height: options.metadata.height }
          : await getImageDimensions(workingFile);
        const maxSide = Math.max(metadata.width, metadata.height);

        if (maxSide > 2560) {
          debugApp(
            `[useFFmpeg] Large image detected (${metadata.width}x${metadata.height}), preprocessing via Canvas API`
          );
          if (canUsePreprocessWorker) {
            try {
              const meta = options?.metadata;
              const preprocessed = await preprocessFileInWorker(
                workingFile,
                {
                  op: 'downscale',
                  maxDimension: 2560,
                  quality: 0.95,
                  outputFormat: 'png',
                  ...(meta ? { sourceWidth: meta.width, sourceHeight: meta.height } : {}),
                },
                signal
              );

              if (preprocessed) {
                workingFile = preprocessed;
                preprocessingApplied = true;
              }
            } catch (err) {
              if (signal.aborted) throw err;
              console.warn('[useFFmpeg] Worker preprocessing failed, falling back:', err);
            }
          }

          if (!preprocessingApplied) {
            const preprocessed = await preprocessImage(
              workingFile,
              {
                maxDimension: 2560,
                quality: 0.95,
                format: 'png', // Use PNG to preserve quality
              },
              decodedBitmap
            );

            if (preprocessed) {
              workingFile = preprocessed;
              preprocessingApplied = true;
            }
          }
        }
      }

      if (preprocessingApplied) {
        debugApp(
          `[useFFmpeg] Preprocessing complete: ${file.size} → ${workingFile.size} bytes (${((workingFile.size / file.size) * 100).toFixed(1)}%)`
        );
      }
    } catch (preprocessError) {
      if (signal.aborted) {
        throw preprocessError;
      }

      const msg = toErrorMessage(preprocessError);
      if (msg.includes('cancelled by user')) {
        throw preprocessError;
      }

      // If preprocessing fails, log but continue with original file
      console.warn('[useFFmpeg] Preprocessing failed, using original file:', preprocessError);
      workingFile = file;
    } finally {
      // Free decoded bitmap memory as early as possible.
      if (decodedBitmap) {
        try {
          decodedBitmap.close();
        } catch {
          // Ignore.
        }
      }
    }

    // Continue with normal conversion flow using workingFile
    setStage('loading');
    setProgress(0.1);

    // Allow the stage update to render before reading/processing file bytes.
    await nextFrame();

    // Use stable names in the virtual FS.
    // Note: Use workingFile (preprocessed) for FFmpeg, but original file name for output
    const inputName = `input.${inferImageExtension(workingFile)}`;
    const mp4OutputName = 'out.mp4';
    const gifOutputName = 'out.gif';
    const outputBaseName = inferSafeBaseName(file);
    const mp4DownloadName = `${outputBaseName}.mp4`;
    const gifDownloadName = `${outputBaseName}.gif`;

    // Cache input file data to avoid redundant fetchFile calls
    // Note: We need to clone before each write because FFmpeg transfers the ArrayBuffer
    const inputFileData = await fetchFile(workingFile);

    // Track partial results for cancellation support
    let mp4Result: ConvertResult | null = null;
    let gifResult: ConvertResult | null = null;

    try {
      // Ensure FFmpeg is available for both MP4 and GIF.
      await load();
      if (!ffmpegRef?.loaded) {
        throw new Error('FFmpeg is not loaded yet. SharedArrayBuffer / COOP+COEP may be missing.');
      }

      let ffmpeg = ffmpegRef;

      setStage('writing');
      setIsLoading(false);

      // Ensure the UI reflects "writing" before FS operations start.
      await nextFrame();

      // Best-effort cleanup in case a previous run didn't delete files.
      try {
        await ffmpeg.deleteFile(inputName);
      } catch {
        // Ignore.
      }
      try {
        await ffmpeg.deleteFile(mp4OutputName);
      } catch {
        // Ignore.
      }
      try {
        await ffmpeg.deleteFile(gifOutputName);
      } catch {
        // Ignore.
      }

      // Clone the data to avoid ArrayBuffer detachment issues
      await ffmpeg.writeFile(inputName, new Uint8Array(inputFileData));

      setStage('running');
      setProgress(0.1);

      // Step 1: Convert image to MP4 (video-only)
      setProgress(0.2);
      const runMp4 = async (codec: 'libx264' | 'mpeg4') => {
        // Preserve quality as much as possible while still constraining extreme inputs.
        // NOTE: commas must be escaped inside FFmpeg expressions.
        const maxSide = 1280;
        const mp4Scale = `scale=min(iw\\,${maxSide}):min(ih\\,${maxSide}):flags=bicubic:force_original_aspect_ratio=decrease`;
        const mp4Vf = (pixFmt: 'yuv420p') =>
          `${mp4Scale},pad=ceil(iw/2)*2:ceil(ih/2)*2:(ow-iw)/2:(oh-ih)/2:color=black,format=${pixFmt}`;

        // FFmpeg may autodetect WebP as the webp_pipe demuxer, which does not honor image2-style
        // options like -loop/-framerate (often resulting in Duration: N/A).
        // Force the image2 demuxer so we get a deterministic still-image timeline.
        const imageInputDemuxerArgs = inputName.endsWith('.webp')
          ? (['-f', 'image2'] as const)
          : [];

        // Use a conservative thread count to improve performance on desktop while limiting memory pressure.
        // x264 threading requires the multi-threaded core (SharedArrayBuffer + cross-origin isolation).
        const mp4Threads = (() => {
          if (!sab().supported) return 1;

          // WebP decode + x264 threading can be unstable/slow in some environments.
          // Prefer stability here; the input is a single still frame.
          if (inputName.endsWith('.webp')) return 1;

          const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
          if (typeof deviceMemory === 'number' && deviceMemory > 0 && deviceMemory <= 4) return 1;

          const hc =
            typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : 1;
          return Math.max(1, Math.min(2, hc));
        })();

        const base = [
          '-y',
          '-hide_banner',
          // Prevent FFmpeg from waiting for stdin (not expected in wasm, but makes hangs easier to rule out).
          '-nostdin',
          ...imageInputDemuxerArgs,
          '-loop',
          '1',
          '-framerate',
          String(mp4Fps),
          '-i',
          inputName,
          // Explicit mapping for determinism.
          '-map',
          '0:v:0',
          // Video-only output for reliability (see note above).
          '-an',
          // Enforce a fixed output duration for a deterministic 1s clip.
          '-t',
          String(mp4DurationSeconds),
        ];

        const runLibx264 = async (pixFmt: 'yuv420p') => {
          const vf = mp4Vf(pixFmt);
          const code = await execWithHardTimeout(
            ffmpeg,
            [
              ...base,
              '-vf',
              vf,
              '-c:v',
              'libx264',
              '-preset',
              'veryfast',
              '-tune',
              'stillimage',
              '-crf',
              // X.com tends to re-encode uploads; CRF ~18 preserves quality while avoiding exotic profiles.
              // (Lossless settings can lead to "High 4:4:4 Predictive" profile even with yuv420p.)
              '18',
              // Force a widely supported H.264 profile.
              '-profile:v',
              'high',
              '-pix_fmt',
              pixFmt,
              '-r',
              String(mp4Fps),
              '-threads',
              String(mp4Threads),
              mp4OutputName,
            ],
            `MP4 conversion (video-only, libx264 CRF 18 ${pixFmt})`,
            signal
          );

          if (code !== 0) {
            const maybe = await tryReadNonEmptyFile(ffmpeg, mp4OutputName);
            if (maybe) return 0;
          }

          return code;
        };

        if (codec === 'libx264') {
          // Prefer 4:2:0 for broad compatibility and smaller size.
          return runLibx264('yuv420p');
        }

        const code = await execWithHardTimeout(
          ffmpeg,
          [
            ...base,
            '-vf',
            mp4Vf('yuv420p'),
            '-c:v',
            'mpeg4',
            '-q:v',
            '2',
            '-r',
            String(mp4Fps),
            mp4OutputName,
          ],
          'MP4 conversion (video-only, mpeg4)',
          signal
        );

        if (code !== 0) {
          const maybe = await tryReadNonEmptyFile(ffmpeg, mp4OutputName);
          if (maybe) return 0;
        }

        return code;
      };

      let exitCodeMp4: number;
      try {
        exitCodeMp4 = await runMp4('libx264');
        if (exitCodeMp4 !== 0) {
          exitCodeMp4 = await runMp4('mpeg4');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/Worker was terminated\.$/.test(message)) {
          setStage('loading');
          setIsLoading(true);
          await load();
          if (!ffmpegRef) throw err;
          const ffmpegRetry = ffmpegRef;
          setStage('writing');
          setIsLoading(false);
          // Clone the data to avoid ArrayBuffer detachment issues
          await ffmpegRetry.writeFile(inputName, new Uint8Array(inputFileData));
          setStage('running');
          setIsLoading(false);
          ffmpeg = ffmpegRetry;
          exitCodeMp4 = await runMp4('mpeg4');
        } else {
          throw err;
        }
      }

      if (exitCodeMp4 !== 0) {
        throw new Error(
          exitCodeMp4 === 1
            ? 'FFmpeg failed or timed out during MP4 video conversion (exit code 1).'
            : `FFmpeg failed during MP4 video conversion (exit code ${exitCodeMp4}).`
        );
      }

      // Step 2: Read MP4 result
      setStage('reading');
      setProgress(0.45);
      const mp4Data = await ffmpeg.readFile(mp4OutputName);
      const mp4Bytes = fileDataToBytes(mp4Data);

      if (mp4Bytes.byteLength === 0) {
        throw new Error(
          'MP4 output is empty. The conversion likely aborted before writing the file. Try a smaller input image or reload the page.'
        );
      }

      const mp4Blob = new Blob([mp4Bytes as unknown as BlobPart], { type: 'video/mp4' });
      const mp4Url = URL.createObjectURL(mp4Blob);

      // Store MP4 result (for partial results if cancelled)
      mp4Result = {
        url: mp4Url,
        mimeType: 'video/mp4',
        filename: mp4DownloadName,
      };

      // Free WASM FS memory before GIF conversion.
      try {
        await ffmpeg.deleteFile(mp4OutputName);
      } catch {
        // Ignore.
      }

      // Check if conversion was cancelled after MP4
      if (signal.aborted) {
        debugApp('[useFFmpeg] Conversion cancelled after MP4, returning partial results');
        return { mp4: mp4Result, gif: null };
      }

      // Step 3: Convert image to GIF (1s, no loop)
      setStage('running');
      setProgress(0.6);
      convertTargetSecondsRef = gifDurationSeconds;
      const targetFrames = gifFrameCount;
      const makeScaleFilter = (maxSide: number) => {
        // Avoid upscaling small inputs while constraining both dimensions.
        // Example produced: scale=min(iw\\,480):min(ih\\,480):flags=lanczos:force_original_aspect_ratio=decrease
        return `scale=min(iw\\,${maxSide}):min(ih\\,${maxSide}):flags=lanczos:force_original_aspect_ratio=decrease`;
      };

      const makeGifFilterChain = (maxSide: number) => {
        // Palette generation is memory-heavy.
        // For a still image, prefer stats_mode=single and preserve transparency.
        return [
          `fps=${gifFps}`,
          makeScaleFilter(maxSide),
          'format=rgba',
          'split[s0][s1]'
            .concat(';[s0]palettegen=stats_mode=single:max_colors=256:reserve_transparent=1[p]')
            .concat(';[s1][p]paletteuse=dither=sierra2_4a:alpha_threshold=128'),
        ].join(',');
      };

      const makeGifFilterChainNoPalette = (maxSide: number) => {
        // Fallback path: avoids palettegen/paletteuse to reduce memory pressure.
        return [`fps=${gifFps}`, makeScaleFilter(maxSide), 'format=rgba'].join(',');
      };

      const makeGifFilterChainSingleFrame = (maxSide: number) => {
        // Last-resort path: write a single-frame GIF (static) to minimize work.
        return [`fps=${gifFps}`, makeScaleFilter(maxSide), 'format=rgba'].join(',');
      };

      const reloadFfmpegForGif = async () => {
        // If the worker crashed (common after WASM abort/OOM), the instance becomes unusable.
        terminateAndReset();
        setStage('loading');
        setIsLoading(true);
        await load();
        if (!ffmpegRef?.loaded) {
          throw new Error('FFmpeg failed to reload after a crash. Please reload the page.');
        }
        ffmpeg = ffmpegRef;
        setStage('writing');
        setIsLoading(false);
        // Clone the data to avoid ArrayBuffer detachment issues
        await ffmpeg.writeFile(inputName, new Uint8Array(inputFileData));
        setStage('running');
        setIsLoading(false);
      };

      // Do not preemptively reload based solely on an 'Aborted()' log line.
      // Some environments emit it even when the output file is valid.
      // Instead, retry only when we observe actual failures (not-loaded/abort/termination).

      const runGif = async (maxSide: number, mode: 'palette' | 'nopalette'): Promise<number> => {
        const imageInputDemuxerArgs = inputName.endsWith('.webp')
          ? (['-f', 'image2'] as const)
          : [];

        // Ensure we don't accidentally read a stale output file from a previous attempt.
        try {
          await ffmpeg.deleteFile(gifOutputName);
        } catch {
          // Ignore.
        }

        const filterChain =
          mode === 'palette' ? makeGifFilterChain(maxSide) : makeGifFilterChainNoPalette(maxSide);
        const code = await execWithHardTimeout(
          ffmpeg,
          [
            '-y',
            '-hide_banner',
            '-nostdin',
            ...imageInputDemuxerArgs,
            '-loop',
            '1',
            '-framerate',
            String(gifFps),
            '-i',
            inputName,
            '-vf',
            filterChain,
            '-threads',
            '1',
            '-frames:v',
            String(targetFrames),
            '-loop',
            '-1',
            gifOutputName,
          ],
          mode === 'palette'
            ? 'GIF conversion from image (palette)'
            : 'GIF conversion from image (no palette)',
          signal
        );

        if (code !== 0) {
          const maybe = await tryReadNonEmptyFile(ffmpeg, gifOutputName);
          if (maybe) return 0;
        }

        return code;
      };

      const runGifSingleFrame = async (maxSide: number): Promise<number> => {
        const imageInputDemuxerArgs = inputName.endsWith('.webp')
          ? (['-f', 'image2'] as const)
          : [];

        try {
          await ffmpeg.deleteFile(gifOutputName);
        } catch {
          // Ignore.
        }

        const filterChain = makeGifFilterChainSingleFrame(maxSide);
        const code = await execWithHardTimeout(
          ffmpeg,
          [
            '-y',
            '-hide_banner',
            '-nostdin',
            ...imageInputDemuxerArgs,
            '-loop',
            '1',
            '-framerate',
            String(gifFps),
            '-i',
            inputName,
            '-vf',
            filterChain,
            '-threads',
            '1',
            '-frames:v',
            '1',
            '-loop',
            '-1',
            gifOutputName,
          ],
          'GIF conversion from image (single frame)',
          signal
        );

        if (code !== 0) {
          const maybe = await tryReadNonEmptyFile(ffmpeg, gifOutputName);
          if (maybe) return 0;
        }

        return code;
      };

      // Optimized fallback strategy: reduce attempts from 11 to ~5-6
      // Use binary search approach for faster convergence: 1280 → 960 → 720 → 480
      // Skip palette mode for smaller sizes to reduce memory pressure
      const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
      const isLowMemoryDevice =
        typeof deviceMemory === 'number' && deviceMemory > 0 && deviceMemory <= 4;
      const isVeryLowMemoryDevice =
        typeof deviceMemory === 'number' && deviceMemory > 0 && deviceMemory <= 2;

      const maxSideCandidates = isVeryLowMemoryDevice
        ? [480]
        : isLowMemoryDevice
          ? [720, 480]
          : [1280, 960, 720, 480];

      // Palette generation is memory-heavy; skip it on low-memory devices.
      const allowPalette = !isLowMemoryDevice;

      let exitCodeGif = 1;
      let lastGifError: unknown = null;

      // Attempt: image -> GIF with smart progressive downscaling.
      for (let i = 0; i < maxSideCandidates.length; i++) {
        const maxSide = maxSideCandidates[i]!;
        const usePalette = allowPalette && maxSide >= 720; // Only use palette for larger sizes (≥720px)

        try {
          if (usePalette) {
            exitCodeGif = await runGif(maxSide, 'palette');
            if (exitCodeGif !== 0) {
              // If palette-based encoding fails, retry without palette filters.
              exitCodeGif = await runGif(maxSide, 'nopalette');
            }
          } else {
            // For smaller sizes, skip palette to save time and memory
            exitCodeGif = await runGif(maxSide, 'nopalette');
          }

          if (exitCodeGif === 0) break;
          lastGifError = new Error(`FFmpeg returned exit code ${exitCodeGif}.`);

          // Early abort if we're already at minimum acceptable size
          if (maxSide <= 480 && exitCodeGif !== 0) {
            console.warn('[useFFmpeg] GIF conversion failed at minimum size (480px), aborting');
            break;
          }
        } catch (err) {
          lastGifError = err;
          const msg = toErrorMessage(err);
          // If FFmpeg lost its loaded state (worker crash/OOM), reload and retry at a smaller size.
          if (
            /Worker was terminated\.$/.test(msg) ||
            isFfmpegNotLoadedError(msg) ||
            isLikelyWasmAbort(msg)
          ) {
            await reloadFfmpegForGif();
            continue;
          }
          break;
        }
      }

      // Final fallback: attempt a static single-frame GIF at the smallest size.
      if (exitCodeGif !== 0) {
        try {
          debugApp('[useFFmpeg] Attempting single-frame GIF as final fallback');
          exitCodeGif = await runGifSingleFrame(360);
        } catch (err) {
          lastGifError = err;
        }
      }

      if (exitCodeGif !== 0) {
        const hint =
          lastGifError && isLikelyWasmAbort(toErrorMessage(lastGifError))
            ? ' GIF conversion likely ran out of memory in the browser. Try a smaller input image, close other tabs, or use a desktop browser.'
            : '';
        throw new Error(
          exitCodeGif === 1
            ? `FFmpeg failed or timed out during GIF conversion (exit code 1).${hint}`
            : `FFmpeg failed during GIF conversion (exit code ${exitCodeGif}).${hint}`
        );
      }

      // Step 4: Read GIF result
      setStage('reading');
      setProgress(0.9);
      const gifData = await ffmpeg.readFile(gifOutputName);
      const gifBytes = fileDataToBytes(gifData);
      const gifBlob = new Blob([gifBytes as unknown as BlobPart], { type: 'image/gif' });
      const gifUrl = URL.createObjectURL(gifBlob);

      // Store GIF result
      gifResult = {
        url: gifUrl,
        mimeType: 'image/gif',
        filename: gifDownloadName,
      };

      // Best-effort cleanup.
      try {
        await ffmpeg.deleteFile(inputName);
        await ffmpeg.deleteFile(gifOutputName);
      } catch {
        // Ignore FS cleanup errors.
      }

      setStage('finalizing');
      setProgress(1);

      return {
        mp4: mp4Result,
        gif: gifResult,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      // Handle cancellation with partial results
      if (message.includes('cancelled by user')) {
        debugApp('[useFFmpeg] Conversion cancelled, returning partial results');
        // If MP4 was completed, return it
        if (mp4Result) {
          return { mp4: mp4Result, gif: null };
        }
        // Otherwise, throw to show cancellation error
      }

      // Parse FFmpeg logs for specific error patterns
      const parseFFmpegError = (logs: string[]): string | null => {
        const lastLogs = logs.slice(-50).join('\n').toLowerCase();

        if (
          lastLogs.includes('unsupported codec') ||
          lastLogs.includes('codec not currently supported')
        ) {
          return 'Unsupported codec detected. Try converting the image to PNG or JPEG first.';
        }
        if (lastLogs.includes('invalid data') || lastLogs.includes('error while decoding')) {
          return 'Invalid or corrupted image file. Please check the file integrity.';
        }
        if (lastLogs.includes('no space left') || lastLogs.includes('cannot allocate memory')) {
          return 'Browser ran out of memory. Close other tabs or try a smaller image.';
        }
        if (
          lastLogs.includes('protocol not found') ||
          lastLogs.includes('unable to find a suitable output format')
        ) {
          return 'Network or file format error. Check your connection and file format.';
        }
        if (lastLogs.includes('dimension') && lastLogs.includes('invalid')) {
          return 'Invalid image dimensions. The image may be too large or corrupted.';
        }

        return null;
      };

      const toUserMessage = (raw: string): string => {
        if (/Worker was terminated\.$/.test(raw)) {
          return 'Conversion timed out. The FFmpeg engine was restarted. Click Convert to try again.';
        }
        if (isFfmpegNotLoadedError(raw)) {
          return 'FFmpeg is not loaded. Click Convert to load the engine and try again.';
        }
        if (isLikelyWasmAbort(raw)) {
          return 'FFmpeg crashed (likely out of memory). Try a smaller image, close other tabs, or use a desktop browser, then click Convert again.';
        }

        // Try to extract specific error from FFmpeg logs
        const ffmpegError = parseFFmpegError(recentFfmpegLogsRef);
        if (ffmpegError) {
          return ffmpegError;
        }

        return raw;
      };

      const userMessage = toUserMessage(message);

      // If the worker crashed / was terminated, the instance is no longer usable until re-loaded.
      if (
        /Worker was terminated\.$/.test(message) ||
        isFfmpegNotLoadedError(message) ||
        isLikelyWasmAbort(message)
      ) {
        if (/Worker was terminated\.$/.test(message)) {
          setEngineErrorCode('exec-timeout');
          const m = message.match(/during (.*)\. Worker was terminated\.$/);
          setEngineErrorContext(m?.[1] ?? null);
        } else if (isFfmpegNotLoadedError(message)) {
          setEngineErrorCode('not-loaded');
        } else if (isLikelyWasmAbort(message)) {
          setEngineErrorCode('wasm-abort');
        } else {
          setEngineErrorCode('worker-terminated');
        }

        terminateAndReset();
        setIsLoaded(false);
        setIsLoading(false);
        setError(userMessage);
        setStage('idle');
      } else {
        if (!engineErrorCode()) {
          setEngineErrorCode('unknown');
        }
        setError(userMessage);
        setStage('ready');
      }
      throw err;
    } finally {
      activeConvertRef = false;
      convertTargetSecondsRef = null;
      abortControllerRef = null;
      resetProgressThrottle();
      setIsConverting(false);
      setIsCancelling(false);
      setStage(isLoaded() ? 'ready' : 'idle');
    }
  };

  /**
   * Cancel the current conversion
   */
  const cancelConversion = () => {
    if (!activeConvertRef) {
      debugApp('[useFFmpeg] No active conversion to cancel');
      return;
    }

    debugApp('[useFFmpeg] Cancelling conversion...');
    setIsCancelling(true);
    abortControllerRef?.abort();
    // Worker termination and cleanup will happen in the abort listener
  };

  /**
   * Cleanup function to explicitly terminate the FFmpeg worker.
   * Should be called on component unmount or when resetting state.
   */
  const cleanup = () => {
    terminateAndReset();
  };

  /**
   * Collect debug information for error reporting
   * @param currentFile - Optional current file being converted (for metadata)
   */
  const getDebugInfo = (currentFile?: File | null): DebugInfo => {
    const conversionMetadata: ConversionMetadata | null = currentFile
      ? {
          inputFileName: currentFile.name,
          inputFileSize: currentFile.size,
          inputFileMime: currentFile.type,
          stage: stage(),
          progress: progress(),
        }
      : null;

    return {
      systemInfo: collectSystemInfo(),
      ffmpegLogs: [...recentFfmpegLogsRef],
      errorCode: engineErrorCode(),
      errorContext: engineErrorContext(),
      errorMessage: error(),
      conversionMetadata,
    };
  };

  return {
    isLoading,
    isLoaded,
    isConverting,
    isCancelling,
    progress,
    stage,
    error,
    hasAttemptedLoad,
    engineErrorCode,
    engineErrorContext,
    downloadProgress,
    loadedFromCache,
    sab,
    load,
    convertImage,
    cancelConversion,
    cleanup,
    getDebugInfo,
  };
}
