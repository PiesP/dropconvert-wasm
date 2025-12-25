// useFFmpeg.ts

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import { useCallback, useMemo, useRef, useState } from 'react';

import { getCoreAssets } from '../lib/ffmpeg/coreAssets';
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

type UseFFmpegState = {
  isLoading: boolean;
  isLoaded: boolean;
  isConverting: boolean;
  progress: number; // 0..1
  stage: FFmpegStage;
  error: string | null;
};

// Core-level timeout forwarded into ffmpeg-core via `ffmpeg.setTimeout(timeout)`.
// The unit is implementation-defined in the core build, so we disable it and rely on a JS watchdog.
const CORE_TIMEOUT = -1;

// JS-level watchdog to recover from cases where the core never returns.
const HARD_TIMEOUT_MS = import.meta.env.DEV ? 15_000 : 60_000;

const DEBUG_FFMPEG_LOGS = import.meta.env.DEV && import.meta.env.VITE_DEBUG_FFMPEG === '1';

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
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const didAttachListenersRef = useRef(false);
  const activeConvertRef = useRef(false);
  const convertTargetSecondsRef = useRef<number | null>(null);
  const loadPromiseRef = useRef<Promise<void> | null>(null);
  const sawAbortLogRef = useRef(false);

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

      const id = setTimeout(() => {
        killed = true;
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
            if (message.trim() === 'Aborted()') {
              // Some WASM aborts can happen right after a command completes, leaving the instance unusable.
              // We treat this as a signal to restart the worker before the next stage.
              sawAbortLogRef.current = true;
            }

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
    async (file: File): Promise<ConvertResults> => {
      const mp4Fps = 30;

      // Single-frame outputs (both MP4 and GIF).
      sawAbortLogRef.current = false;
      activeConvertRef.current = true;
      const mp4FrameCount = 1;
      const gifFrameCount = 1;
      const targetSeconds = 1 / mp4Fps;
      convertTargetSecondsRef.current = targetSeconds;

      setState((s) => ({
        ...s,
        isConverting: true,
        progress: 0,
        stage: 'loading',
        error: null,
      }));

      // Use stable names in the virtual FS.
      const inputName = `input.${inferImageExtension(file)}`;
      const mp4OutputName = 'out.mp4';
      const gifOutputName = 'out.gif';
      const outputBaseName = inferSafeBaseName(file);
      const mp4DownloadName = `${outputBaseName}.mp4`;
      const gifDownloadName = `${outputBaseName}.gif`;

      try {
        // Ensure FFmpeg is available for both MP4 and GIF.
        await load();
        if (!ffmpegRef.current?.loaded) {
          throw new Error(
            'FFmpeg is not loaded yet. SharedArrayBuffer / COOP+COEP may be missing.'
          );
        }

        let ffmpeg = ffmpegRef.current;

        setState((s) => ({ ...s, stage: 'writing', isLoading: false }));

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

        await ffmpeg.writeFile(inputName, await fetchFile(file));

        setState((s) => ({ ...s, stage: 'running', progress: 0.1 }));

        // Step 1: Convert image to MP4
        setState((s) => ({ ...s, stage: 'running', progress: 0.2 }));
        const frameCount = mp4FrameCount;
        const runMp4 = async (codec: 'libx264' | 'mpeg4') => {
          // Preserve quality as much as possible while still constraining extreme inputs.
          // NOTE: commas must be escaped inside FFmpeg expressions.
          const maxSide = 1280;
          const mp4Scale = `scale=min(iw\\,${maxSide}):min(ih\\,${maxSide}):flags=lanczos:force_original_aspect_ratio=decrease`;

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
            '-an',
            '-movflags',
            '+faststart',
          ];

          const runLibx264 = async (pixFmt: 'yuv444p' | 'yuv420p') => {
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
                '0',
                '-pix_fmt',
                pixFmt,
                '-threads',
                '1',
                mp4OutputName,
              ],
              `MP4 conversion (libx264 lossless ${pixFmt})`
            );

            if (code !== 0) {
              const maybe = await tryReadNonEmptyFile(ffmpeg, mp4OutputName);
              if (maybe) return 0;
            }

            return code;
          };

          if (codec === 'libx264') {
            // Prefer 4:4:4 for maximum quality; fall back to 4:2:0 for compatibility.
            let code = await runLibx264('yuv444p');
            if (code !== 0) {
              code = await runLibx264('yuv420p');
            }
            return code;
          }

          const code = await execWithHardTimeout(
            ffmpeg,
            [...base, '-c:v', 'mpeg4', '-q:v', '2', mp4OutputName],
            'MP4 conversion (mpeg4)'
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
            setState((s) => ({ ...s, stage: 'loading', isLoading: true }));
            await load();
            if (!ffmpegRef.current) throw err;
            const ffmpegRetry = ffmpegRef.current;
            setState((s) => ({ ...s, stage: 'writing', isLoading: false }));
            await ffmpegRetry.writeFile(inputName, await fetchFile(file));
            setState((s) => ({ ...s, stage: 'running', isLoading: false }));
            exitCodeMp4 = await execWithHardTimeout(
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
                'pad=ceil(iw/2)*2:ceil(ih/2)*2:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p',
                '-an',
                '-pix_fmt',
                'yuv420p',
                '-c:v',
                'mpeg4',
                '-q:v',
                '2',
                mp4OutputName,
              ],
              'MP4 conversion retry (mpeg4)'
            );
          } else {
            throw err;
          }
        }

        if (exitCodeMp4 !== 0) {
          throw new Error(
            exitCodeMp4 === 1
              ? 'FFmpeg failed or timed out during MP4 conversion (exit code 1).'
              : `FFmpeg failed during MP4 conversion (exit code ${exitCodeMp4}).`
          );
        }

        // Step 2: Read MP4 result
        setState((s) => ({ ...s, stage: 'reading', progress: 0.5 }));
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

        // Step 3: Convert image to GIF (single frame)
        setState((s) => ({ ...s, stage: 'running', progress: 0.6 }));
        const targetFrames = gifFrameCount;
        const makeScaleFilter = (maxSide: number) => {
          // Avoid upscaling small inputs while constraining both dimensions.
          // Example produced: scale=min(iw\\,480):min(ih\\,480):flags=lanczos:force_original_aspect_ratio=decrease
          return `scale=min(iw\\,${maxSide}):min(ih\\,${maxSide}):flags=lanczos:force_original_aspect_ratio=decrease`;
        };

        const makeGifFilterChain = (maxSide: number) => {
          // Palette generation is memory-heavy.
          // For a single-frame GIF, prefer stats_mode=single and preserve transparency.
          return [
            makeScaleFilter(maxSide),
            'format=rgba',
            'split[s0][s1]'
              .concat(';[s0]palettegen=stats_mode=single:max_colors=256:reserve_transparent=1[p]')
              .concat(';[s1][p]paletteuse=dither=sierra2_4a:alpha_threshold=128'),
          ].join(',');
        };

        const makeGifFilterChainNoPalette = (maxSide: number) => {
          // Fallback path: avoids palettegen/paletteuse to reduce memory pressure.
          return [makeScaleFilter(maxSide), 'format=rgba'].join(',');
        };

        const makeGifFilterChainSingleFrame = (maxSide: number) => {
          // Last-resort path: write a single-frame GIF (static) to minimize work.
          return [makeScaleFilter(maxSide), 'format=rgba'].join(',');
        };

        const reloadFfmpegForGif = async () => {
          // If the worker crashed (common after WASM abort/OOM), the instance becomes unusable.
          terminateAndReset();
          setState((s) => ({ ...s, stage: 'loading', isLoading: true }));
          await load();
          if (!ffmpegRef.current?.loaded) {
            throw new Error('FFmpeg failed to reload after a crash. Please reload the page.');
          }
          ffmpeg = ffmpegRef.current;
          setState((s) => ({ ...s, stage: 'writing', isLoading: false }));
          await ffmpeg.writeFile(inputName, await fetchFile(file));
          setState((s) => ({ ...s, stage: 'running', isLoading: false }));
        };

        // Proactively restart between stages to avoid heap fragmentation / post-run aborts
        // leaving the instance in an unloaded state.
        if (sawAbortLogRef.current) {
          await reloadFfmpegForGif();
          sawAbortLogRef.current = false;
        } else {
          // Even without an explicit abort log, restarting improves reliability on some browsers.
          await reloadFfmpegForGif();
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
              '-i',
              inputName,
              '-vf',
              filterChain,
              '-threads',
              '1',
              '-frames:v',
              String(targetFrames),
              '-loop',
              '0',
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
              '-i',
              inputName,
              '-vf',
              filterChain,
              '-threads',
              '1',
              '-frames:v',
              '1',
              '-loop',
              '0',
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

        const maxSideCandidates = [1280, 960, 720, 480, 360];

        let exitCodeGif = 1;
        let lastGifError: unknown = null;

        // Attempt: image -> GIF (single frame), with progressive downscaling.
        for (const maxSide of maxSideCandidates) {
          try {
            exitCodeGif = await runGif(maxSide, 'palette');
            if (exitCodeGif !== 0) {
              // If palette-based encoding fails, retry without palette filters.
              exitCodeGif = await runGif(maxSide, 'nopalette');
            }
            if (exitCodeGif === 0) break;
            lastGifError = new Error(`FFmpeg returned exit code ${exitCodeGif}.`);
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
            exitCodeGif = await runGifSingleFrame(maxSideCandidates[maxSideCandidates.length - 1]!);
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
        setState((s) => ({ ...s, stage: 'reading', progress: 0.9 }));
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

        setState((s) => ({ ...s, stage: 'finalizing', progress: 1 }));

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
