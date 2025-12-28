// canvasPreprocessor.ts
// Canvas-based image preprocessing for performance optimization

export type PreprocessOptions = {
  maxDimension: number;
  quality: number; // 0-1, JPEG/WebP quality
  format: 'png' | 'jpeg';
};

/**
 * Preprocesses a large image by downscaling it using Canvas API.
 * Returns a new File if preprocessing was applied, or null if the image
 * is already within the specified dimensions.
 */
export async function preprocessImage(
  file: File,
  options: PreprocessOptions
): Promise<File | null> {
  const img = await loadImageFromFile(file);
  const { width, height } = img;
  const maxSide = Math.max(width, height);

  // Skip preprocessing if image is already small enough
  if (maxSide <= options.maxDimension) {
    console.log(
      `[CanvasPreprocessor] Image (${width}x${height}) is within limits, skipping preprocessing`
    );
    return null;
  }

  // Calculate new dimensions maintaining aspect ratio
  const scale = options.maxDimension / maxSide;
  const newWidth = Math.round(width * scale);
  const newHeight = Math.round(height * scale);

  console.log(
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
  ctx.drawImage(img, 0, 0, newWidth, newHeight);

  // Convert to Blob
  const blob = await canvasToBlob(canvas, options.format, options.quality);

  // Create new File with appropriate name
  const originalName = file.name.replace(/\.[^.]+$/, ''); // Remove extension
  const newFileName = `${originalName}_preprocessed.${options.format}`;

  console.log(
    `[CanvasPreprocessor] Preprocessed: ${file.size} → ${blob.size} bytes (${((blob.size / file.size) * 100).toFixed(1)}%)`
  );

  return new File([blob], newFileName, { type: blob.type });
}

/**
 * Transcodes a WebP image to PNG using Canvas API.
 * This can improve FFmpeg processing performance since the WebP decoder is slow.
 */
export async function transcodeWebPToPNG(file: File): Promise<File> {
  console.log('[CanvasPreprocessor] Transcoding WebP to PNG...');

  const img = await loadImageFromFile(file);
  const { width, height } = img;

  // Create canvas matching original dimensions
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : document.createElement('canvas');

  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d', { alpha: true }) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) {
    throw new Error('Failed to get 2D context from canvas');
  }

  // Draw image to canvas (this decodes the WebP in the browser)
  ctx.drawImage(img, 0, 0);

  // Convert to PNG blob (quality: 1.0 for lossless)
  const blob = await canvasToBlob(canvas, 'png', 1.0);

  const originalName = file.name.replace(/\.[^.]+$/, '');
  const newFileName = `${originalName}_transcoded.png`;

  console.log(`[CanvasPreprocessor] WebP transcoded: ${file.size} → ${blob.size} bytes`);

  return new File([blob], newFileName, { type: 'image/png' });
}

/**
 * Loads an image file into an HTMLImageElement.
 * Creates an object URL and waits for the image to load.
 */
async function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
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
