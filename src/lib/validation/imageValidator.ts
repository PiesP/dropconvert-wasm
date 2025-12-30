// Image validation logic for pre-conversion checks

export type ValidationWarning = {
  type: 'size' | 'dimensions' | 'webp_performance' | 'avif_performance' | 'format';
  message: string;
  severity: 'low' | 'medium' | 'high';
};

export type ValidationError = {
  type: 'size' | 'format' | 'corrupted' | 'unsupported' | 'browser_unsupported';
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
  // Optional decoded bitmap to reuse for preprocessing.
  // Only provided when it is likely to be immediately useful (e.g., large non-WebP/AVIF images).
  decodedBitmap?: ImageBitmap;
};

// Magic byte signatures for common image formats
const MAGIC_BYTES = {
  PNG: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  JPEG: [0xff, 0xd8, 0xff],
  GIF: [0x47, 0x49, 0x46, 0x38],
  WEBP: [0x52, 0x49, 0x46, 0x46], // "RIFF" header, followed by "WEBP" at offset 8
  BMP: [0x42, 0x4d],
  // ISO Base Media File Format (ISOBMFF) - used by AVIF, HEIC/HEIF
  FTYP: [0x66, 0x74, 0x79, 0x70], // "ftyp" at bytes 4-7
  // AVIF brand identifiers (bytes 8-11)
  AVIF_BRANDS: {
    avif: [0x61, 0x76, 0x69, 0x66],
    avis: [0x61, 0x76, 0x69, 0x73],
    avci: [0x61, 0x76, 0x63, 0x69],
  },
  // HEIC/HEIF brand identifiers (bytes 8-11)
  HEIF_BRANDS: {
    heic: [0x68, 0x65, 0x69, 0x63],
    heix: [0x68, 0x65, 0x69, 0x78],
    hevc: [0x68, 0x65, 0x76, 0x63],
    mif1: [0x6d, 0x69, 0x66, 0x31],
    heim: [0x68, 0x65, 0x69, 0x6d],
    heis: [0x68, 0x65, 0x69, 0x73],
  },
  // JPEG XL signatures
  JXL_CODESTREAM: [0xff, 0x0a], // Naked codestream
  JXL_CONTAINER: [0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a],
  // TIFF signatures
  TIFF_LITTLE_ENDIAN: [0x49, 0x49, 0x2a, 0x00], // "II" + 42 (little-endian)
  TIFF_BIG_ENDIAN: [0x4d, 0x4d, 0x00, 0x2a], // "MM" + 42 (big-endian)
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
    const header = await readFileHeader(file, 16); // Read first 16 bytes (increased for JPEG XL container)

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

    // Check AVIF (ftyp at bytes 4-7, brand at bytes 8-11)
    if (header.length >= 12) {
      const hasFtyp = MAGIC_BYTES.FTYP.every((byte, i) => header[i + 4] === byte);
      if (hasFtyp) {
        const brand = header.slice(8, 12);

        // Check AVIF brands
        for (const brandBytes of Object.values(MAGIC_BYTES.AVIF_BRANDS)) {
          if (brandBytes.every((byte, i) => brand[i] === byte)) {
            return 'avif';
          }
        }

        // Check HEIF brands
        for (const brandBytes of Object.values(MAGIC_BYTES.HEIF_BRANDS)) {
          if (brandBytes.every((byte, i) => brand[i] === byte)) {
            return 'heic';
          }
        }
      }
    }

    // Check JPEG XL - codestream format (2 bytes)
    if (header.length >= 2 && MAGIC_BYTES.JXL_CODESTREAM.every((byte, i) => header[i] === byte)) {
      return 'jxl';
    }

    // Check JPEG XL - container format (12 bytes)
    if (header.length >= 12 && MAGIC_BYTES.JXL_CONTAINER.every((byte, i) => header[i] === byte)) {
      return 'jxl';
    }

    // Check TIFF - little endian
    if (
      header.length >= 4 &&
      MAGIC_BYTES.TIFF_LITTLE_ENDIAN.every((byte, i) => header[i] === byte)
    ) {
      return 'tiff';
    }

    // Check TIFF - big endian
    if (header.length >= 4 && MAGIC_BYTES.TIFF_BIG_ENDIAN.every((byte, i) => header[i] === byte)) {
      return 'tiff';
    }

    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Load image and extract metadata
 */
async function loadImageMetadata(
  file: File
): Promise<{ width: number; height: number; bitmap?: ImageBitmap }> {
  // Try createImageBitmap first (more efficient if available)
  if (typeof createImageBitmap !== 'undefined') {
    try {
      const bitmap = await createImageBitmap(file);
      const { width, height } = bitmap;
      // Do not close here; caller may choose to reuse it.
      return { width, height, bitmap };
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

  if (import.meta.env.DEV) {
    console.debug('[Validator] File details:', {
      name: file.name,
      mimeType,
      sizeBytes,
      detectedFormat,
    });
  }

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
    avif: ['image/avif'],
    heic: ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'],
    jxl: ['image/jxl'],
    tiff: ['image/tiff', 'image/tiff-fx'],
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
  let decodedBitmap: ImageBitmap | undefined;
  try {
    const loaded = await loadImageMetadata(file);
    dimensions = { width: loaded.width, height: loaded.height };
    decodedBitmap = loaded.bitmap;
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

  // Decide whether we should keep the decoded bitmap for reuse.
  // Keep only when we expect an immediate downscale path, and avoid keeping it for WebP/AVIF
  // since those formats go through a dedicated transcode path.
  const shouldKeepDecodedBitmap =
    !!decodedBitmap &&
    detectedFormat !== 'webp' &&
    detectedFormat !== 'avif' &&
    maxDimension > DIMENSION_WARNING_PREPROCESSING;

  if (!shouldKeepDecodedBitmap && decodedBitmap) {
    try {
      decodedBitmap.close();
    } catch {
      // Ignore.
    }
    decodedBitmap = undefined;
  }

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
    if (import.meta.env.DEV) {
      console.debug('[Validator] WebP detected, adding performance warning');
    }
    warnings.push({
      type: 'webp_performance',
      message:
        "WebP format detected. FFmpeg's WebP decoder is slower than other formats. The image will be automatically converted to PNG first for better performance.",
      severity: 'medium',
    });
  }

  // Validation 7: AVIF performance warning
  if (detectedFormat === 'avif') {
    if (import.meta.env.DEV) {
      console.debug('[Validator] AVIF detected, adding performance warning');
    }
    warnings.push({
      type: 'avif_performance',
      message:
        'AVIF format detected. The image will be automatically converted to PNG first for better performance with FFmpeg.',
      severity: 'medium',
    });
  }

  // Validation 8: Unsupported formats (HEIC/HEIF)
  if (detectedFormat === 'heic') {
    errors.push({
      type: 'browser_unsupported',
      message:
        'HEIC/HEIF format detected but not supported in most browsers. Please convert to JPEG, PNG, WebP, or AVIF first using an image editor or online converter.',
    });

    if (decodedBitmap) {
      try {
        decodedBitmap.close();
      } catch {
        // Ignore.
      }
      decodedBitmap = undefined;
    }

    return {
      valid: false,
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

  // Validation 9: Unsupported formats (JPEG XL)
  if (detectedFormat === 'jxl') {
    errors.push({
      type: 'browser_unsupported',
      message:
        'JPEG XL format detected but not supported by browsers yet. Please convert to JPEG, PNG, WebP, or AVIF first.',
    });

    if (decodedBitmap) {
      try {
        decodedBitmap.close();
      } catch {
        // Ignore.
      }
      decodedBitmap = undefined;
    }

    return {
      valid: false,
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

  // Validation 10: Unsupported formats (TIFF)
  if (detectedFormat === 'tiff') {
    errors.push({
      type: 'browser_unsupported',
      message:
        'TIFF format detected but not supported in browsers. Please convert to PNG, JPEG, or WebP first.',
    });

    if (decodedBitmap) {
      try {
        decodedBitmap.close();
      } catch {
        // Ignore.
      }
      decodedBitmap = undefined;
    }

    return {
      valid: false,
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

  if (import.meta.env.DEV) {
    console.debug('[Validator] Final validation result:', {
      valid: true,
      warningsCount: warnings.length,
      errorsCount: errors.length,
    });
  }

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
    ...(decodedBitmap ? { decodedBitmap } : {}),
  };
}
