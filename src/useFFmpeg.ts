// useFFmpeg.ts

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import { useCallback, useMemo, useRef, useState } from 'react';

export type ConvertFormat = 'mp4' | 'gif';

export type ConvertResult = {
  url: string;
  mimeType: string;
  filename: string;
};

type UseFFmpegState = {
  isLoading: boolean;
  isLoaded: boolean;
  isConverting: boolean;
  progress: number; // 0..1
  stage: 'idle' | 'loading' | 'ready' | 'writing' | 'running' | 'reading' | 'finalizing';
  error: string | null;
};

// NOTE: The multi-threaded core package provides the worker file.
// @ffmpeg/core@0.12.6 (single-thread) does not ship ffmpeg-core.worker.js under dist/esm.
const CORE_BASE_URL = 'https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/esm';

// Core-level timeout forwarded into ffmpeg-core via `ffmpeg.setTimeout(timeout)`.
// The unit is implementation-defined in the core build, so we disable it and rely on a JS watchdog.
const CORE_TIMEOUT = -1;

// JS-level watchdog to recover from cases where the core never returns.
const HARD_TIMEOUT_MS = import.meta.env.DEV ? 15_000 : 60_000;

const DEBUG_FFMPEG_LOGS = import.meta.env.DEV && import.meta.env.VITE_DEBUG_FFMPEG === '1';

type CoreAssets = {
  coreURL: string;
  wasmURL: string;
  workerURL: string;
};

let coreAssetsPromise: Promise<CoreAssets> | null = null;

async function getCoreAssets(): Promise<CoreAssets> {
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

async function decodeImageToRgba(
  file: File,
  maxWidth: number
): Promise<{ rgba: Uint8ClampedArray; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);

  const scale = bitmap.width > maxWidth ? maxWidth / bitmap.width : 1;
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  // Prefer OffscreenCanvas when available.
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height });

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to create 2D canvas context for GIF encoding.');
  }

  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const { data } = ctx.getImageData(0, 0, width, height);
  return { rgba: data, width, height };
}

async function encodeStillGifFromImage(file: File): Promise<Uint8Array> {
  // This app converts a single image into a very short GIF.
  // Since it's a single image, we encode one frame with a short delay.
  const { rgba, width, height } = await decodeImageToRgba(file, 640);

  const palette = quantize(rgba, 256);
  const index = applyPalette(rgba, palette);

  const gif = GIFEncoder();
  gif.writeFrame(index, width, height, {
    palette,
    delay: 100, // ms (0.1s)
    repeat: 0, // -1=once, 0=forever, >0=count
  });
  gif.finish();
  return gif.bytes();
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizeFfmpegTimeToSeconds(time: number): number {
  // `time` unit isn't explicitly documented in typings. Empirically it may be in
  // microseconds (ffmpeg internal), milliseconds, or seconds depending on build.
  // We normalize heuristically.
  if (!Number.isFinite(time) || time <= 0) return 0;
  if (time > 10_000_000) return time / 1_000_000; // likely microseconds
  if (time > 10_000) return time / 1_000; // likely milliseconds
  return time; // likely seconds
}

function parseFfmpegLogTimeToSeconds(message: string): number | null {
  // Example: "time=00:00:00.08"
  const match = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(message);
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  const ss = Number(match[3]);
  if (![hh, mm, ss].every(Number.isFinite)) return null;
  return hh * 3600 + mm * 60 + ss;
}

function inferImageExtension(file: File): string {
  const dot = file.name.lastIndexOf('.');
  if (dot >= 0 && dot < file.name.length - 1) {
    return file.name.slice(dot + 1).toLowerCase();
  }

  // Fallback mapping by MIME type.
  switch (file.type) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'image/bmp':
      return 'bmp';
    case 'image/avif':
      return 'avif';
    default:
      return 'img';
  }
}

function getSharedArrayBufferSupport() {
  const hasSAB = typeof SharedArrayBuffer !== 'undefined';
  const isIsolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated === true;
  return { hasSAB, isIsolated, supported: hasSAB && isIsolated };
}

export function useFFmpeg() {
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const didAttachListenersRef = useRef(false);
  const activeConvertRef = useRef(false);
  const convertTargetSecondsRef = useRef<number | null>(null);
  const loadPromiseRef = useRef<Promise<void> | null>(null);

  const terminateAndReset = useCallback(() => {
    const current = ffmpegRef.current;
    try {
      current?.terminate();
    } catch {
      // Ignore termination errors.
    }
    ffmpegRef.current = null;
    didAttachListenersRef.current = false;
    loadPromiseRef.current = null;
  }, []);

  const execWithHardTimeout = useCallback(
    async (ffmpeg: FFmpeg, args: string[], label: string): Promise<number> => {
      let killed = false;

      const execPromise = ffmpeg.exec(args, CORE_TIMEOUT).catch((err) => {
        if (killed) return 1;
        throw err;
      });

      const hardTimeoutPromise = new Promise<never>((_, reject) => {
        const id = setTimeout(() => {
          killed = true;
          terminateAndReset();
          // Avoid unhandled rejection if the exec promise rejects after termination.
          void execPromise.catch(() => undefined);
          reject(new Error(`FFmpeg appears stuck during ${label}. Worker was terminated.`));
        }, HARD_TIMEOUT_MS);

        // Ensure timer is cleared when exec finishes first.
        void execPromise.finally(() => clearTimeout(id));
      });

      return Promise.race([execPromise, hardTimeoutPromise]);
    },
    [terminateAndReset]
  );

  const [state, setState] = useState<UseFFmpegState>({
    isLoading: false,
    isLoaded: false,
    isConverting: false,
    progress: 0,
    stage: 'idle',
    error: null,
  });

  const sab = useMemo(() => getSharedArrayBufferSupport(), []);

  const load = useCallback(async () => {
    if (!sab.supported) {
      setState((s) => ({
        ...s,
        error:
          'SharedArrayBuffer is not available. This app requires cross-origin isolation (COOP/COEP) and a compatible browser.',
      }));
      return;
    }

    // If already loaded, reflect that in state.
    if (ffmpegRef.current?.loaded) {
      setState((s) => ({ ...s, isLoaded: true, isLoading: false, stage: 'ready' }));
      return;
    }

    // De-dupe concurrent load calls.
    if (loadPromiseRef.current) {
      await loadPromiseRef.current;
      return;
    }

    setState((s) => ({ ...s, isLoading: true, stage: 'loading', error: null }));

    const p = (async () => {
      try {
        if (!ffmpegRef.current) {
          ffmpegRef.current = new FFmpeg();
        }

        const ffmpeg = ffmpegRef.current;

        if (!didAttachListenersRef.current) {
          didAttachListenersRef.current = true;

          ffmpeg.on('progress', ({ progress, time }) => {
            // NOTE: The library docs mention progress is accurate only when input/output lengths match.
            // For our "looped single image" conversions, `progress` may stay at 0, so we also use `time`.
            if (!activeConvertRef.current) return;

            const byProgress = Number.isFinite(progress) ? progress : NaN;
            const byTime = (() => {
              const target = convertTargetSecondsRef.current;
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

            setState((s) => ({ ...s, progress: Math.max(s.progress, next) }));
          });

          ffmpeg.on('log', ({ message }) => {
            // Useful for debugging; keep it quiet by default (the raw output is very verbose).
            if (import.meta.env.DEV) {
              if (DEBUG_FFMPEG_LOGS || isInterestingFfmpegLog(message)) {
                console.debug('[ffmpeg]', message);
              }
            }

            // Some builds provide better timing info via logs than progress events.
            if (!activeConvertRef.current) return;
            const target = convertTargetSecondsRef.current;
            if (!target || target <= 0) return;

            const seconds = parseFfmpegLogTimeToSeconds(message);
            if (seconds === null) return;
            const next = clamp01(seconds / target);

            setState((s) => ({ ...s, progress: Math.max(s.progress, next) }));
          });
        }

        const { coreURL, wasmURL, workerURL } = await getCoreAssets();
        await ffmpeg.load({ coreURL, wasmURL, workerURL });

        setState((s) => ({ ...s, isLoaded: true, isLoading: false, progress: 0, stage: 'ready' }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setState((s) => ({
          ...s,
          isLoading: false,
          isLoaded: false,
          stage: 'idle',
          error: message,
        }));
        terminateAndReset();
        throw err;
      } finally {
        loadPromiseRef.current = null;
      }
    })();

    loadPromiseRef.current = p;
    await p;
  }, [sab.supported, terminateAndReset]);

  const convertImage = useCallback(
    async (file: File, format: ConvertFormat): Promise<ConvertResult> => {
      const mp4Fps = 30;

      const targetSeconds = 0.1;
      activeConvertRef.current = true;
      convertTargetSecondsRef.current = targetSeconds;

      setState((s) => ({
        ...s,
        isConverting: true,
        progress: 0,
        stage: 'writing',
        error: null,
      }));

      // Use stable names in the virtual FS.
      const inputName = `input.${inferImageExtension(file)}`;
      const outputName = format === 'mp4' ? 'out.mp4' : 'out.gif';

      try {
        if (format === 'gif') {
          setState((s) => ({ ...s, stage: 'running', progress: 0.2 }));

          const gifBytes = await encodeStillGifFromImage(file);

          setState((s) => ({ ...s, stage: 'finalizing', progress: 1 }));

          // Ensure the Blob is backed by a plain ArrayBuffer.
          const blobBytes = new Uint8Array(gifBytes.byteLength);
          blobBytes.set(gifBytes);
          const blob = new Blob([blobBytes], { type: 'image/gif' });
          const url = URL.createObjectURL(blob);

          return {
            url,
            mimeType: 'image/gif',
            filename: outputName,
          };
        }

        if (!ffmpegRef.current?.loaded) {
          throw new Error('FFmpeg is not loaded yet.');
        }

        const ffmpeg = ffmpegRef.current;

        // Best-effort cleanup in case a previous run didn't delete files.
        try {
          await ffmpeg.deleteFile(inputName);
        } catch {
          // Ignore.
        }
        try {
          await ffmpeg.deleteFile(outputName);
        } catch {
          // Ignore.
        }

        await ffmpeg.writeFile(inputName, await fetchFile(file));

        setState((s) => ({ ...s, stage: 'running' }));

        if (format === 'mp4') {
          const frameCount = Math.max(1, Math.ceil(targetSeconds * mp4Fps));
          // For MP4, ensure even dimensions and a widely compatible pixel format.
          // NOTE: Avoid expressions with commas (e.g. min(720,iw)) because commas can be
          // interpreted as filter separators unless carefully escaped.
          const runMp4 = async (codec: 'libx264' | 'mpeg4') => {
            const base = [
              '-y',
              '-hide_banner',
              '-loop',
              '1',
              '-framerate',
              String(mp4Fps),
              '-i',
              inputName,
              '-frames:v',
              String(frameCount),
              '-vf',
              // Downscale (no upscaling), then force even dimensions.
              'scale=720:-2:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p',
              '-an',
              '-pix_fmt',
              'yuv420p',
            ];

            if (codec === 'libx264') {
              return execWithHardTimeout(
                ffmpeg,
                [
                  ...base,
                  '-c:v',
                  'libx264',
                  '-preset',
                  'ultrafast',
                  '-crf',
                  '28',
                  '-threads',
                  '1',
                  outputName,
                ],
                'MP4 conversion (libx264)'
              );
            }

            // Fallback codec: generally less complex than x264 and can avoid pthread-related deadlocks.
            return execWithHardTimeout(
              ffmpeg,
              [...base, '-c:v', 'mpeg4', '-q:v', '5', outputName],
              'MP4 conversion (mpeg4)'
            );
          };

          let exitCode: number;
          try {
            exitCode = await runMp4('libx264');
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (/Worker was terminated\.$/.test(message)) {
              // Try reloading and retrying with a simpler codec.
              setState((s) => ({ ...s, stage: 'loading', isLoading: true }));
              await load();
              if (!ffmpegRef.current) throw err;
              const ffmpegRetry = ffmpegRef.current;
              // Re-create the input file in the new worker's FS.
              setState((s) => ({ ...s, stage: 'writing', isLoading: false }));
              await ffmpegRetry.writeFile(inputName, await fetchFile(file));
              setState((s) => ({ ...s, stage: 'running', isLoading: false }));
              exitCode = await execWithHardTimeout(
                ffmpegRetry,
                [
                  '-y',
                  '-hide_banner',
                  '-loop',
                  '1',
                  '-framerate',
                  String(mp4Fps),
                  '-i',
                  inputName,
                  '-frames:v',
                  String(frameCount),
                  '-vf',
                  'scale=720:-2:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p',
                  '-an',
                  '-pix_fmt',
                  'yuv420p',
                  '-c:v',
                  'mpeg4',
                  '-q:v',
                  '5',
                  outputName,
                ],
                'MP4 conversion retry (mpeg4)'
              );
            } else {
              throw err;
            }
          }

          if (exitCode !== 0) {
            throw new Error(
              exitCode === 1
                ? 'FFmpeg failed or timed out during MP4 conversion (exit code 1).'
                : `FFmpeg failed during MP4 conversion (exit code ${exitCode}).`
            );
          }
        }

        setState((s) => ({ ...s, stage: 'reading', progress: Math.max(s.progress, 0.95) }));
        const data = await ffmpeg.readFile(outputName);

        // According to ffmpeg.wasm docs this is typically Uint8Array, but typings can be wider.
        const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));

        // Ensure the Blob is backed by a plain ArrayBuffer (not SharedArrayBuffer).
        const blobBytes = new Uint8Array(bytes.byteLength);
        blobBytes.set(bytes);

        const mimeType = format === 'mp4' ? 'video/mp4' : 'image/gif';
        const blob = new Blob([blobBytes], { type: mimeType });
        const url = URL.createObjectURL(blob);

        // Best-effort cleanup.
        try {
          await ffmpeg.deleteFile(inputName);
          await ffmpeg.deleteFile(outputName);
        } catch {
          // Ignore FS cleanup errors.
        }

        setState((s) => ({ ...s, stage: 'finalizing', progress: 1 }));

        return {
          url,
          mimeType,
          filename: outputName,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // If we killed the worker, the instance is no longer usable until re-loaded.
        if (/Worker was terminated\.$/.test(message)) {
          terminateAndReset();
          setState((s) => ({
            ...s,
            isLoaded: false,
            isLoading: false,
            error: message,
            stage: 'idle',
          }));
        } else {
          setState((s) => ({ ...s, error: message, stage: 'ready' }));
        }
        throw err;
      } finally {
        activeConvertRef.current = false;
        convertTargetSecondsRef.current = null;
        setState((s) => ({ ...s, isConverting: false, stage: s.isLoaded ? 'ready' : 'idle' }));
      }
    },
    [execWithHardTimeout, load, terminateAndReset]
  );

  return {
    ...state,
    sab,
    load,
    convertImage,
  };
}
