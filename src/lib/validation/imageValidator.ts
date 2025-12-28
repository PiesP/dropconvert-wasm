// Image validation logic for pre-conversion checks

export type ValidationWarning = {
  type: 'size' | 'dimensions' | 'webp_performance' | 'format';
  message: string;
  severity: 'low' | 'medium' | 'high';
};

export type ValidationError = {
  type: 'size' | 'format' | 'corrupted' | 'unsupported';
  message: string;
};

export type ImageMetadata = {
  width: number;
  height: number;
  sizeBytes: number;
  format: string;
  mimeType: string;
};

export type ValidationResult = {
  valid: boolean;
  warnings: ValidationWarning[];
  errors: ValidationError[];
  metadata: ImageMetadata;
};

// Magic byte signatures for common image formats
const MAGIC_BYTES = {
  PNG: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  JPEG: [0xff, 0xd8, 0xff],
  GIF: [0x47, 0x49, 0x46, 0x38],
  WEBP: [0x52, 0x49, 0x46, 0x46], // "RIFF" header, followed by "WEBP" at offset 8
  BMP: [0x42, 0x4d],
} as const;

// File size thresholds (in bytes)
const SIZE_ERROR_THRESHOLD = 100 * 1024 * 1024; // 100MB (hard limit)
const SIZE_WARNING_THRESHOLD = 50 * 1024 * 1024; // 50MB (warning)

// Dimension thresholds (in pixels)
const DIMENSION_WARNING_LARGE = 4000; // Very large dimensions
const DIMENSION_WARNING_PREPROCESSING = 2560; // Will require preprocessing

/**
 * Read the first N bytes of a file
 */
async function readFileHeader(file: File, bytes: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const blob = file.slice(0, bytes);

    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(new Uint8Array(reader.result));
      } else {
        reject(new Error('Failed to read file as ArrayBuffer'));
      }
    };

    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * Detect image format from magic bytes
 */
export async function detectImageFormat(file: File): Promise<string> {
  try {
    const header = await readFileHeader(file, 12); // Read first 12 bytes

    // Check PNG
    if (header.length >= 8 && MAGIC_BYTES.PNG.every((byte, i) => header[i] === byte)) {
      return 'png';
    }

    // Check JPEG
    if (header.length >= 3 && MAGIC_BYTES.JPEG.every((byte, i) => header[i] === byte)) {
      return 'jpeg';
    }

    // Check GIF
    if (header.length >= 4 && MAGIC_BYTES.GIF.every((byte, i) => header[i] === byte)) {
      return 'gif';
    }

    // Check WebP (RIFF header + WEBP signature at offset 8)
    if (
      header.length >= 12 &&
      MAGIC_BYTES.WEBP.every((byte, i) => header[i] === byte) &&
      header[8] === 0x57 && // 'W'
      header[9] === 0x45 && // 'E'
      header[10] === 0x42 && // 'B'
      header[11] === 0x50 // 'P'
    ) {
      return 'webp';
    }

    // Check BMP
    if (header.length >= 2 && MAGIC_BYTES.BMP.every((byte, i) => header[i] === byte)) {
      return 'bmp';
    }

    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Load image and extract metadata
 */
async function loadImageMetadata(file: File): Promise<{ width: number; height: number }> {
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
      reject(new Error('Failed to load image'));
    };

    img.src = url;
  });
}

/**
 * Validate an image file before conversion
 */
export async function validateImageFile(file: File): Promise<ValidationResult> {
  const warnings: ValidationWarning[] = [];
  const errors: ValidationError[] = [];

  // Detect format from magic bytes
  const detectedFormat = await detectImageFormat(file);
  const mimeType = file.type;
  const sizeBytes = file.size;

  console.log('[Validator] File details:', {
    name: file.name,
    mimeType,
    sizeBytes,
    detectedFormat,
  });

  // Validation 1: File size hard limit
  if (sizeBytes > SIZE_ERROR_THRESHOLD) {
    errors.push({
      type: 'size',
      message: `File is too large (${(sizeBytes / 1024 / 1024).toFixed(1)}MB). Maximum supported size is 100MB due to browser memory limitations.`,
    });

    // Return early - cannot process files this large
    return {
      valid: false,
      warnings,
      errors,
      metadata: {
        width: 0,
        height: 0,
        sizeBytes,
        format: detectedFormat,
        mimeType,
      },
    };
  }

  // Validation 2: Format detection
  if (detectedFormat === 'unknown') {
    errors.push({
      type: 'format',
      message:
        'Unable to detect image format. The file may be corrupted or in an unsupported format.',
    });

    return {
      valid: false,
      warnings,
      errors,
      metadata: {
        width: 0,
        height: 0,
        sizeBytes,
        format: detectedFormat,
        mimeType,
      },
    };
  }

  // Validation 3: MIME type consistency check
  const mimeFormatMap: Record<string, string[]> = {
    png: ['image/png'],
    jpeg: ['image/jpeg', 'image/jpg'],
    gif: ['image/gif'],
    webp: ['image/webp'],
    bmp: ['image/bmp', 'image/x-bmp'],
  };

  const expectedMimes = mimeFormatMap[detectedFormat] ?? [];
  if (mimeType && !expectedMimes.includes(mimeType) && detectedFormat !== 'unknown') {
    warnings.push({
      type: 'format',
      message: `File extension/MIME type (${mimeType}) doesn't match detected format (${detectedFormat}). The file may have been renamed incorrectly.`,
      severity: 'low',
    });
  }

  // Load image to get dimensions
  let dimensions: { width: number; height: number };
  try {
    dimensions = await loadImageMetadata(file);
  } catch (err) {
    errors.push({
      type: 'corrupted',
      message: `Failed to load image. The file may be corrupted or in an unsupported format. ${err instanceof Error ? err.message : ''}`,
    });

    return {
      valid: false,
      warnings,
      errors,
      metadata: {
        width: 0,
        height: 0,
        sizeBytes,
        format: detectedFormat,
        mimeType,
      },
    };
  }

  const { width, height } = dimensions;
  const maxDimension = Math.max(width, height);

  // Validation 4: File size warning
  if (sizeBytes > SIZE_WARNING_THRESHOLD) {
    warnings.push({
      type: 'size',
      message: `Large file size (${(sizeBytes / 1024 / 1024).toFixed(1)}MB). Conversion may be slow and could fail on low-memory devices.`,
      severity: 'high',
    });
  }

  // Validation 5: Dimension warnings
  if (maxDimension > DIMENSION_WARNING_LARGE) {
    warnings.push({
      type: 'dimensions',
      message: `Very large dimensions (${width}×${height}). This may cause memory issues and slow conversion. Consider resizing the image before converting.`,
      severity: 'high',
    });
  } else if (maxDimension > DIMENSION_WARNING_PREPROCESSING) {
    warnings.push({
      type: 'dimensions',
      message: `Large dimensions (${width}×${height}). The image will be automatically downscaled to ${DIMENSION_WARNING_PREPROCESSING}px during conversion for better performance.`,
      severity: 'low',
    });
  }

  // Validation 6: WebP performance warning
  if (detectedFormat === 'webp') {
    console.log('[Validator] WebP detected, adding performance warning');
    warnings.push({
      type: 'webp_performance',
      message:
        "WebP format detected. FFmpeg's WebP decoder is slower than other formats. The image will be automatically converted to PNG first for better performance.",
      severity: 'medium',
    });
  }

  console.log('[Validator] Final validation result:', {
    valid: true,
    warningsCount: warnings.length,
    errorsCount: errors.length,
  });

  return {
    valid: true,
    warnings,
    errors,
    metadata: {
      width,
      height,
      sizeBytes,
      format: detectedFormat,
      mimeType,
    },
  };
}
