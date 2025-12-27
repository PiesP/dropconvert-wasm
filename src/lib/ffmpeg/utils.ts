import type { FFmpeg } from '@ffmpeg/ffmpeg';

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function normalizeFfmpegTimeToSeconds(time: number): number {
  // `time` unit isn't explicitly documented in typings. Empirically it may be in
  // microseconds (ffmpeg internal), milliseconds, or seconds depending on build.
  // We normalize heuristically.
  if (!Number.isFinite(time) || time <= 0) return 0;
  if (time > 10_000_000) return time / 1_000_000; // likely microseconds
  if (time > 10_000) return time / 1_000; // likely milliseconds
  return time; // likely seconds
}

export function parseFfmpegLogTimeToSeconds(message: string): number | null {
  // Example: "time=00:00:00.08"
  const match = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(message);
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  const ss = Number(match[3]);
  if (![hh, mm, ss].every(Number.isFinite)) return null;
  return hh * 3600 + mm * 60 + ss;
}

export function fileDataToBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  return new TextEncoder().encode(String(data));
}

export async function tryReadNonEmptyFile(
  ffmpeg: FFmpeg,
  filename: string
): Promise<Uint8Array | null> {
  try {
    const data = await ffmpeg.readFile(filename);
    const bytes = fileDataToBytes(data);
    return bytes.byteLength > 0 ? bytes : null;
  } catch {
    return null;
  }
}

/**
 * Check if a file exists in the FFmpeg virtual filesystem.
 */
export async function fileExists(ffmpeg: FFmpeg, filename: string): Promise<boolean> {
  try {
    await ffmpeg.readFile(filename);
    return true;
  } catch {
    return false;
  }
}
