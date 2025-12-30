// canvasPreprocessor.ts
// Canvas-based image preprocessing for performance optimization

export type PreprocessOptions = {
  maxDimension: number;
  quality: number; // 0-1, JPEG/WebP quality
  format: 'png' | 'jpeg';
};

export type TranscodeToPngOptions = {
  // If provided, the output will be resized so that max(width, height) <= maxDimension.
  maxDimension?: number;
  // Optional source dimensions (e.g., from validation) so we can compute target size
  // without decoding first. This enables createImageBitmap resizing on decode.
  sourceWidth?: number;
  sourceHeight?: number;
};

type LoadedImageSource = {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
};

function debugLog(...args: unknown[]): void {
  if (!import.meta.env.DEV) return;
  console.debug(...args);
}

function fitWithinMaxDimension(
  width: number,
  height: number,
  maxDimension: number
): { width: number; height: number; didScale: boolean } {
  const maxSide = Math.max(width, height);
  if (!Number.isFinite(maxSide) || maxSide <= 0) {
    return {
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
      didScale: false,
    };
  }
  if (maxSide <= maxDimension) return { width, height, didScale: false };
  const scale = maxDimension / maxSide;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    didScale: true,
  };
}

/**
 * Preprocesses a large image by downscaling it using Canvas API.
 * Returns a new File if preprocessing was applied, or null if the image
 * is already within the specified dimensions.
 */
export async function preprocessImage(
  file: File,
  options: PreprocessOptions,
  decodedBitmap?: ImageBitmap
): Promise<File | null> {
  const img: LoadedImageSource = decodedBitmap
    ? {
        source: decodedBitmap,
        width: decodedBitmap.width,
        height: decodedBitmap.height,
        close: () => undefined,
      }
    : await loadImageFromFile(file);

  const { width, height } = img;
  const maxSide = Math.max(width, height);

  // Skip preprocessing if image is already small enough
  if (maxSide <= options.maxDimension) {
    debugLog(
      `[CanvasPreprocessor] Image (${width}x${height}) is within limits, skipping preprocessing`
    );
    img.close();
    return null;
  }

  // Calculate new dimensions maintaining aspect ratio
  const scale = options.maxDimension / maxSide;
  const newWidth = Math.round(width * scale);
  const newHeight = Math.round(height * scale);

  debugLog(
    `[CanvasPreprocessor] Downscaling ${width}x${height} → ${newWidth}x${newHeight} (scale: ${scale.toFixed(2)})`
  );

  // Use OffscreenCanvas if available (better performance, no DOM pollution)
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(newWidth, newHeight)
      : document.createElement('canvas');

  canvas.width = newWidth;
  canvas.height = newHeight;

  const ctx = canvas.getContext('2d', { alpha: true }) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) {
    throw new Error('Failed to get 2D context from canvas');
  }

  // Enable high-quality image smoothing
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Draw downscaled image
  ctx.drawImage(img.source, 0, 0, newWidth, newHeight);

  // Convert to Blob
  let blob: Blob;
  try {
    blob = await canvasToBlob(canvas, options.format, options.quality);
  } finally {
    img.close();
  }

  // Create new File with appropriate name
  const originalName = file.name.replace(/\.[^.]+$/, ''); // Remove extension
  const newFileName = `${originalName}_preprocessed.${options.format}`;

  debugLog(
    `[CanvasPreprocessor] Preprocessed: ${file.size} → ${blob.size} bytes (${((blob.size / file.size) * 100).toFixed(1)}%)`
  );

  return new File([blob], newFileName, { type: blob.type });
}

/**
 * Transcodes a WebP image to PNG using Canvas API.
 * This can improve FFmpeg processing performance since the WebP decoder is slow.
 */
export async function transcodeWebPToPNG(
  file: File,
  options?: TranscodeToPngOptions
): Promise<File> {
  return transcodeImageToPNG(file, 'webp', options);
}

/**
 * Transcodes an AVIF image to PNG using Canvas API.
 * This improves FFmpeg processing performance, similar to WebP transcoding.
 */
export async function transcodeAVIFToPNG(
  file: File,
  options?: TranscodeToPngOptions
): Promise<File> {
  return transcodeImageToPNG(file, 'avif', options);
}

async function transcodeImageToPNG(
  file: File,
  label: 'webp' | 'avif',
  options?: TranscodeToPngOptions
): Promise<File> {
  const maxDimension = options?.maxDimension;

  const wanted = (() => {
    if (!maxDimension) return null;
    const w = options?.sourceWidth;
    const h = options?.sourceHeight;
    if (!w || !h) return null;
    const next = fitWithinMaxDimension(w, h, maxDimension);
    return next.didScale ? next : null;
  })();

  debugLog(
    `[CanvasPreprocessor] Transcoding ${label.toUpperCase()} to PNG${maxDimension ? ` (max ${maxDimension}px)` : ''}...`
  );

  const img = await loadImageFromFile(
    file,
    wanted ? { width: wanted.width, height: wanted.height } : undefined
  );

  const output = (() => {
    if (wanted) return { width: wanted.width, height: wanted.height };
    if (!maxDimension) return { width: img.width, height: img.height };
    const fitted = fitWithinMaxDimension(img.width, img.height, maxDimension);
    return { width: fitted.width, height: fitted.height };
  })();

  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(output.width, output.height)
      : document.createElement('canvas');

  canvas.width = output.width;
  canvas.height = output.height;

  const ctx = canvas.getContext('2d', { alpha: true }) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) {
    img.close();
    throw new Error('Failed to get 2D context from canvas');
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  let blob: Blob;
  try {
    ctx.drawImage(img.source, 0, 0, output.width, output.height);
    blob = await canvasToBlob(canvas, 'png', 1.0);
  } finally {
    img.close();
  }

  const originalName = file.name.replace(/\.[^.]+$/, '');
  const newFileName = `${originalName}_transcoded.png`;

  debugLog(
    `[CanvasPreprocessor] ${label.toUpperCase()} transcoded: ${file.size} → ${blob.size} bytes`
  );

  return new File([blob], newFileName, { type: 'image/png' });
}

/**
 * Loads an image file into an HTMLImageElement.
 * Creates an object URL and waits for the image to load.
 */
async function loadImageFromFile(
  file: File,
  resizeTo?: { width: number; height: number }
): Promise<LoadedImageSource> {
  // Prefer ImageBitmap (often off-main-thread decode, no DOM node creation).
  if (typeof createImageBitmap !== 'undefined') {
    try {
      const bitmap = await createImageBitmap(
        file,
        resizeTo
          ? { resizeWidth: resizeTo.width, resizeHeight: resizeTo.height, resizeQuality: 'high' }
          : undefined
      );
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      // Fall through to HTMLImageElement.
    }
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({
        source: img,
        width: img.width,
        height: img.height,
        close: () => undefined,
      });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for preprocessing. File may be corrupted.'));
    };

    img.src = url;
  });
}

/**
 * Converts a canvas to a Blob.
 * Handles both OffscreenCanvas and HTMLCanvasElement.
 */
async function canvasToBlob(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  format: 'png' | 'jpeg',
  quality: number
): Promise<Blob> {
  const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';

  // OffscreenCanvas has async convertToBlob()
  if (canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type: mimeType, quality });
  }

  // HTMLCanvasElement uses callback-based toBlob()
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Canvas toBlob returned null'));
        }
      },
      mimeType,
      quality
    );
  });
}
