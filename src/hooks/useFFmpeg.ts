// useFFmpeg.ts

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import { createMemo, createSignal } from 'solid-js';
import { getCachedAssets, isIndexedDBAvailable, setCachedAssets } from '../lib/ffmpeg/cacheManager';
import { type DownloadProgress, getCoreAssets } from '../lib/ffmpeg/coreAssets';
import { isFfmpegNotLoadedError, isLikelyWasmAbort, toErrorMessage } from '../lib/ffmpeg/errors';
import { inferImageExtension, inferSafeBaseName } from '../lib/ffmpeg/fileNames';
import {
  clamp01,
  fileDataToBytes,
  normalizeFfmpegTimeToSeconds,
  parseFfmpegLogTimeToSeconds,
  tryReadNonEmptyFile,
} from '../lib/ffmpeg/utils';

export type ConvertFormat = 'mp4' | 'gif';

export type ConvertResult = {
  url: string;
  mimeType: string;
  filename: string;
};

export type ConvertResults = {
  mp4: ConvertResult;
  gif: ConvertResult;
};

export type FFmpegStage =
  | 'idle'
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

// Core-level timeout forwarded into ffmpeg-core via `ffmpeg.setTimeout(timeout)`.
// The unit is implementation-defined in the core build, so we disable it and rely on a JS watchdog.
const CORE_TIMEOUT = -1;

// JS-level watchdog to recover from cases where the core never returns.
const HARD_TIMEOUT_MS = import.meta.env.DEV ? 15_000 : 60_000;

const DEBUG_FFMPEG_LOGS = import.meta.env.DEV && import.meta.env.VITE_DEBUG_FFMPEG === '1';
const DEBUG_APP_LOGS = import.meta.env.DEV && import.meta.env.VITE_DEBUG_APP === '1';

const MAX_RECENT_FFMPEG_LOGS = 200;

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
  let sawAbortLogRef = false;
  const recentFfmpegLogsRef: string[] = [];

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
    label: string
  ): Promise<number> => {
    let killed = false;
    const startedAt = performance.now();
    const argsForLog = formatArgsForLog(args);

    if (import.meta.env.DEV && (DEBUG_APP_LOGS || DEBUG_FFMPEG_LOGS)) {
      console.debug(`[ffmpeg][exec:start] ${label}`, { args: argsForLog });
    }

    const id = setTimeout(() => {
      killed = true;

      // Emit as much context as possible before terminating the worker.
      if (import.meta.env.DEV) {
        const recent = dumpRecentFfmpegLogs(60);
        console.error(`[ffmpeg][exec:timeout] ${label}`, {
          timeoutMs: HARD_TIMEOUT_MS,
          args: argsForLog,
          recentLogs: recent,
        });
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

    if (import.meta.env.DEV && (DEBUG_APP_LOGS || DEBUG_FFMPEG_LOGS)) {
      const elapsedMs = Math.round(performance.now() - startedAt);
      console.debug(`[ffmpeg][exec:done] ${label}`, { code, elapsedMs });
    }

    return code;
  };

  const [isLoading, setIsLoading] = createSignal(false);
  const [isLoaded, setIsLoaded] = createSignal(false);
  const [isConverting, setIsConverting] = createSignal(false);
  const [progress, setProgress] = createSignal(0);
  const [stage, setStage] = createSignal<FFmpegStage>('idle');
  const [error, setError] = createSignal<string | null>(null);
  const [downloadProgress, setDownloadProgress] = createSignal<DownloadProgress>({
    loaded: 0,
    total: 0,
    percent: 0,
  });
  const [loadedFromCache, setLoadedFromCache] = createSignal(false);

  const sab = createMemo(() => getSharedArrayBufferSupport());

  const load = async () => {
    console.log('[useFFmpeg] load() called', {
      sabSupported: sab().supported,
      alreadyLoaded: ffmpegRef?.loaded,
    });

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
      console.log('[useFFmpeg] Already loaded, returning early');
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

    const p = (async () => {
      try {
        if (!ffmpegRef) {
          console.log('[useFFmpeg] Creating new FFmpeg instance');
          ffmpegRef = new FFmpeg();
        } else {
          console.log('[useFFmpeg] Reusing existing FFmpeg instance');
        }

        const ffmpeg = ffmpegRef;

        if (!didAttachListenersRef) {
          console.log('[useFFmpeg] Attaching event listeners');
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

            setProgress((p) => Math.max(p, next));
          });

          ffmpeg.on('log', ({ message }) => {
            if (message.trim() === 'Aborted()') {
              // Some WASM aborts can happen right after a command completes, leaving the instance unusable.
              // We treat this as a signal to restart the worker before the next stage.
              sawAbortLogRef = true;
            }

            // Keep recent logs for post-mortem debugging (timeouts, aborts, crashes).
            // Always store them (low overhead), but only print to console when debugging.
            const ring = recentFfmpegLogsRef;
            ring.push(message);
            if (ring.length > MAX_RECENT_FFMPEG_LOGS) {
              ring.splice(0, ring.length - MAX_RECENT_FFMPEG_LOGS);
            }

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

            setProgress((p) => Math.max(p, next));
          });
        } else {
          console.log('[useFFmpeg] Event listeners already attached');
        }

        console.log('[useFFmpeg] Loading FFmpeg core assets...');

        // Cache-first strategy: check IndexedDB first, fallback to network
        const FFMPEG_VERSION = '0.12.6';
        const cacheAvailable = await isIndexedDBAvailable();
        let fromCache = false;
        let assets: { coreURL: string; wasmURL: string; workerURL: string };

        if (cacheAvailable) {
          console.log('[useFFmpeg] Checking IndexedDB cache...');
          const cached = await getCachedAssets(FFMPEG_VERSION);

          if (cached) {
            console.log('[useFFmpeg] Cache hit! Using cached assets');
            assets = cached;
            fromCache = true;
          } else {
            console.log('[useFFmpeg] Cache miss, downloading from network...');
            assets = await getCoreAssets((progress) => {
              setDownloadProgress(progress);
            });

            // Try to cache the downloaded assets
            console.log('[useFFmpeg] Caching assets for future use...');
            const cacheSuccess = await setCachedAssets(FFMPEG_VERSION, assets);
            if (cacheSuccess) {
              console.log('[useFFmpeg] Assets cached successfully');
            } else {
              console.warn('[useFFmpeg] Failed to cache assets');
            }
          }
        } else {
          console.log('[useFFmpeg] IndexedDB unavailable, downloading from network...');
          assets = await getCoreAssets((progress) => {
            setDownloadProgress(progress);
          });
        }

        setLoadedFromCache(fromCache);
        console.log('[useFFmpeg] Core assets ready, calling ffmpeg.load()');

        await ffmpeg.load(assets);

        console.log('[useFFmpeg] FFmpeg core loaded successfully');
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
        setError(message);
        terminateAndReset();
        throw err;
      } finally {
        loadPromiseRef = null;
      }
    })();

    loadPromiseRef = p;
    await p;
  };

  const convertImage = async (file: File): Promise<ConvertResults> => {
    // For a still image, we target a 1s MP4 at 1 fps.
    // Note: using `-frames:v 1` can make some muxing paths treat the output duration as 0,
    // which may result in an MP4 without audio packets/track in some environments.
    const mp4Fps = 1;
    const mp4DurationSeconds = 1;
    const gifFps = 2;
    const gifDurationSeconds = 1;

    // MP4: 1-second clip from a looped still image. GIF: 1-second animation from a looped still image (no looping on playback).
    sawAbortLogRef = false;
    activeConvertRef = true;
    const gifFrameCount = Math.max(1, Math.round(gifFps * gifDurationSeconds));
    convertTargetSecondsRef = mp4DurationSeconds;

    setIsConverting(true);
    setProgress(0);
    setStage('loading');
    setError(null);

    // Use stable names in the virtual FS.
    const inputName = `input.${inferImageExtension(file)}`;
    const mp4OutputName = 'out.mp4';
    const gifOutputName = 'out.gif';
    const outputBaseName = inferSafeBaseName(file);
    const mp4DownloadName = `${outputBaseName}.mp4`;
    const gifDownloadName = `${outputBaseName}.gif`;

    // Cache input file data to avoid redundant fetchFile calls
    // Note: We need to clone before each write because FFmpeg transfers the ArrayBuffer
    const inputFileData = await fetchFile(file);

    try {
      // Ensure FFmpeg is available for both MP4 and GIF.
      await load();
      if (!ffmpegRef?.loaded) {
        throw new Error('FFmpeg is not loaded yet. SharedArrayBuffer / COOP+COEP may be missing.');
      }

      let ffmpeg = ffmpegRef;

      setStage('writing');
      setIsLoading(false);

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

      // Step 1: Convert image to MP4 (video + silent audio in one command)
      setStage('running');
      setProgress(0.2);
      const runMp4 = async (codec: 'libx264' | 'mpeg4') => {
        // Preserve quality as much as possible while still constraining extreme inputs.
        // NOTE: commas must be escaped inside FFmpeg expressions.
        const maxSide = 1280;
        const mp4Scale = `scale=min(iw\\,${maxSide}):min(ih\\,${maxSide}):in_range=pc:out_range=tv:flags=lanczos:force_original_aspect_ratio=decrease`;

        const base = [
          '-y',
          '-hide_banner',
          '-loop',
          '1',
          '-framerate',
          String(mp4Fps),
          '-i',
          inputName,
          // Silent audio input.
          '-f',
          'lavfi',
          '-i',
          // aevalsrc generates audio by evaluating expressions per-channel.
          // 0|0 => stereo silence. `d` is duration in seconds, `s` is sample rate.
          `aevalsrc=0|0:d=${mp4DurationSeconds}:s=48000`,
          // Explicit stream mapping for deterministic output.
          '-map',
          '0:v:0',
          '-map',
          '1:a:0',
          '-c:a',
          'aac',
          '-b:a',
          '128k',
          '-ac',
          '2',
          '-ar',
          '48000',
          // Enforce a fixed output duration so the muxer writes audio packets.
          '-t',
          String(mp4DurationSeconds),
          '-movflags',
          '+faststart',
        ];

        const runLibx264 = async (pixFmt: 'yuv420p') => {
          const vf = `${mp4Scale},pad=ceil(iw/2)*2:ceil(ih/2)*2:(ow-iw)/2:(oh-ih)/2:color=black,format=${pixFmt}`;
          const code = await execWithHardTimeout(
            ffmpeg,
            [
              ...base,
              '-vf',
              vf,
              '-c:v',
              'libx264',
              '-preset',
              'slow',
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
              '1',
              mp4OutputName,
            ],
            `MP4 conversion (video+silent-audio, libx264 CRF 18 ${pixFmt})`
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
            `${mp4Scale},pad=ceil(iw/2)*2:ceil(ih/2)*2:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p`,
            '-c:v',
            'mpeg4',
            '-q:v',
            '2',
            '-r',
            String(mp4Fps),
            mp4OutputName,
          ],
          'MP4 conversion (video+silent-audio, mpeg4)'
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

      // Free WASM FS memory before GIF conversion.
      try {
        await ffmpeg.deleteFile(mp4OutputName);
      } catch {
        // Ignore.
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

      // Only reload FFmpeg worker if it crashed (detected via abort log).
      // Keeping the worker alive between MP4→GIF improves performance.
      if (sawAbortLogRef) {
        await reloadFfmpegForGif();
        sawAbortLogRef = false;
      }

      const runGif = async (maxSide: number, mode: 'palette' | 'nopalette'): Promise<number> => {
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
            : 'GIF conversion from image (no palette)'
        );

        if (code !== 0) {
          const maybe = await tryReadNonEmptyFile(ffmpeg, gifOutputName);
          if (maybe) return 0;
        }

        return code;
      };

      const runGifSingleFrame = async (maxSide: number): Promise<number> => {
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
          'GIF conversion from image (single frame)'
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
      const maxSideCandidates = [1280, 960, 720, 480];

      let exitCodeGif = 1;
      let lastGifError: unknown = null;

      // Attempt: image -> GIF with smart progressive downscaling.
      for (let i = 0; i < maxSideCandidates.length; i++) {
        const maxSide = maxSideCandidates[i]!;
        const usePalette = maxSide >= 720; // Only use palette for larger sizes (≥720px)

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
          if (isFfmpegNotLoadedError(msg) || isLikelyWasmAbort(msg)) {
            await reloadFfmpegForGif();
            continue;
          }
          break;
        }
      }

      // Final fallback: attempt a static single-frame GIF at the smallest size.
      if (exitCodeGif !== 0) {
        try {
          console.log('[useFFmpeg] Attempting single-frame GIF as final fallback');
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
        mp4: {
          url: mp4Url,
          mimeType: 'video/mp4',
          filename: mp4DownloadName,
        },
        gif: {
          url: gifUrl,
          mimeType: 'image/gif',
          filename: gifDownloadName,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // If the worker crashed / was terminated, the instance is no longer usable until re-loaded.
      if (
        /Worker was terminated\.$/.test(message) ||
        isFfmpegNotLoadedError(message) ||
        isLikelyWasmAbort(message)
      ) {
        terminateAndReset();
        setIsLoaded(false);
        setIsLoading(false);
        setError(message);
        setStage('idle');
      } else {
        setError(message);
        setStage('ready');
      }
      throw err;
    } finally {
      activeConvertRef = false;
      convertTargetSecondsRef = null;
      setIsConverting(false);
      setStage(isLoaded() ? 'ready' : 'idle');
    }
  };

  /**
   * Cleanup function to explicitly terminate the FFmpeg worker.
   * Should be called on component unmount or when resetting state.
   */
  const cleanup = () => {
    terminateAndReset();
  };

  return {
    isLoading,
    isLoaded,
    isConverting,
    progress,
    stage,
    error,
    downloadProgress,
    loadedFromCache,
    sab,
    load,
    convertImage,
    cleanup,
  };
}
