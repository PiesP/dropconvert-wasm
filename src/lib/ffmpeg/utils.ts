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

/**
 * Estimate the output size of a GIF file.
 * This is a rough heuristic based on dimensions, fps, and duration.
 * Formula: width × height × fps × duration × 0.08 (approximate bytes per pixel-frame)
 */
export function estimateGifSize(
  width: number,
  height: number,
  fps: number,
  durationSeconds: number
): number {
  // Rough estimate: ~0.08 bytes per pixel-frame for GIF with palette
  const bytesPerPixelFrame = 0.08;
  const totalPixelFrames = width * height * fps * durationSeconds;
  return Math.ceil(totalPixelFrames * bytesPerPixelFrame);
}

/**
 * Calculate optimal starting dimensions for GIF conversion based on size estimate.
 * Returns a recommended maximum side dimension to keep output under targetSizeMB.
 */
export function calculateOptimalGifDimensions(
  originalWidth: number,
  originalHeight: number,
  fps: number,
  durationSeconds: number,
  targetSizeMB: number = 20
): number {
  const targetBytes = targetSizeMB * 1024 * 1024;
  const estimatedSize = estimateGifSize(originalWidth, originalHeight, fps, durationSeconds);

  if (estimatedSize <= targetBytes) {
    // Original size is fine, no downscaling needed
    return Math.max(originalWidth, originalHeight);
  }

  // Calculate scaling factor to reach target size
  // size ∝ width × height, so scale = sqrt(targetSize / estimatedSize)
  const scaleFactor = Math.sqrt(targetBytes / estimatedSize);
  const maxSide = Math.max(originalWidth, originalHeight);
  const recommendedMaxSide = Math.floor(maxSide * scaleFactor);

  // Clamp to reasonable bounds (at least 360px, at most original size)
  return Math.max(360, Math.min(recommendedMaxSide, maxSide));
}

/**
 * Extract image dimensions from a File object using browser APIs
 * Uses createImageBitmap when available (faster), falls back to Image()
 */
export async function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  // Try createImageBitmap first (more efficient if available)
  if (typeof createImageBitmap !== 'undefined') {
    try {
      const bitmap = await createImageBitmap(file);
      const { width, height } = bitmap;
      bitmap.close(); // Release resources
      return { width, height };
    } catch {
      // Fall through to Image() method
    }
  }

  // Fallback to Image()
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.width, height: img.height });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for dimension extraction'));
    };

    img.src = url;
  });
}
