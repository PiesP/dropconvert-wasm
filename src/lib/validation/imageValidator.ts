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

// Maximum bytes to read for fast dimension parsing.
// This avoids a full decode during validation for common formats.
const DIMENSION_PARSE_MAX_BYTES = 256 * 1024;

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

function readU16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readU24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16)) +
    bytes[offset + 3]! * 2 ** 24
  );
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! * 2 ** 24 +
    (bytes[offset + 1]! << 16) +
    (bytes[offset + 2]! << 8) +
    bytes[offset + 3]!
  );
}

function readU64BEAsNumber(bytes: Uint8Array, offset: number): number | null {
  if (offset + 8 > bytes.length) return null;
  const hi = readU32BE(bytes, offset);
  const lo = readU32BE(bytes, offset + 4);
  const value = (BigInt(hi) << 32n) | BigInt(lo);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(value);
}

function readAscii4(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset]!,
    bytes[offset + 1]!,
    bytes[offset + 2]!,
    bytes[offset + 3]!
  );
}

function isPlausibleDimensions(width: number, height: number): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
  if (width <= 0 || height <= 0) return false;
  // Guardrail against clearly bogus headers.
  if (width > 200_000 || height > 200_000) return false;
  return true;
}

function tryParsePngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  // PNG signature (8) + IHDR chunk header (8) + width/height (8)
  if (bytes.length < 24) return null;
  const isPng = MAGIC_BYTES.PNG.every((b, i) => bytes[i] === b);
  if (!isPng) return null;

  // First chunk should be IHDR.
  if (
    bytes[12] !== 0x49 || // I
    bytes[13] !== 0x48 || // H
    bytes[14] !== 0x44 || // D
    bytes[15] !== 0x52 // R
  ) {
    return null;
  }

  const width = readU32BE(bytes, 16);
  const height = readU32BE(bytes, 20);
  if (!isPlausibleDimensions(width, height)) return null;
  return { width, height };
}

function tryParseGifDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  // Header (6) + logical screen descriptor (4)
  if (bytes.length < 10) return null;
  const isGif = MAGIC_BYTES.GIF.every((b, i) => bytes[i] === b);
  if (!isGif) return null;
  const width = readU16LE(bytes, 6);
  const height = readU16LE(bytes, 8);
  if (!isPlausibleDimensions(width, height)) return null;
  return { width, height };
}

function tryParseBmpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  // BMP header is at least 26 bytes to reach width/height fields.
  if (bytes.length < 26) return null;
  const isBmp = MAGIC_BYTES.BMP.every((b, i) => bytes[i] === b);
  if (!isBmp) return null;

  const width = readU32LE(bytes, 18);
  // Height can be negative (top-down); treat as absolute.
  const rawHeight = (readU32LE(bytes, 22) | 0) as number;
  const height = Math.abs(rawHeight);
  if (!isPlausibleDimensions(width, height)) return null;
  return { width, height };
}

function tryParseJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4) return null;
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  // Scan marker segments until we find a SOF marker.
  let i = 2;
  while (i + 3 < bytes.length) {
    // Find next marker (0xFF).
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }

    // Skip fill bytes.
    while (i < bytes.length && bytes[i] === 0xff) i++;
    if (i >= bytes.length) return null;

    const marker = bytes[i]!;
    i++;

    // Standalone markers without a length.
    if (marker === 0xd9 || marker === 0xda) break; // EOI / SOS
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }

    if (i + 1 >= bytes.length) return null;
    const segmentLength = (bytes[i]! << 8) | bytes[i + 1]!;
    if (segmentLength < 2) return null;

    const segmentStart = i + 2;

    const isSofMarker =
      marker === 0xc0 ||
      marker === 0xc1 ||
      marker === 0xc2 ||
      marker === 0xc3 ||
      marker === 0xc5 ||
      marker === 0xc6 ||
      marker === 0xc7 ||
      marker === 0xc9 ||
      marker === 0xca ||
      marker === 0xcb ||
      marker === 0xcd ||
      marker === 0xce ||
      marker === 0xcf;

    if (isSofMarker) {
      // SOF segment: [precision][height hi][height lo][width hi][width lo]
      if (segmentStart + 4 >= bytes.length) return null;
      const height = (bytes[segmentStart + 1]! << 8) | bytes[segmentStart + 2]!;
      const width = (bytes[segmentStart + 3]! << 8) | bytes[segmentStart + 4]!;
      if (!isPlausibleDimensions(width, height)) return null;
      return { width, height };
    }

    // Skip segment.
    i = segmentStart + (segmentLength - 2);
  }

  return null;
}

function tryParseWebpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 16) return null;
  const isRiff = MAGIC_BYTES.WEBP.every((b, i) => bytes[i] === b);
  if (!isRiff) return null;
  if (bytes[8] !== 0x57 || bytes[9] !== 0x45 || bytes[10] !== 0x42 || bytes[11] !== 0x50) {
    return null;
  }

  // Iterate RIFF chunks.
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type0 = bytes[offset]!;
    const type1 = bytes[offset + 1]!;
    const type2 = bytes[offset + 2]!;
    const type3 = bytes[offset + 3]!;
    const chunkType = String.fromCharCode(type0, type1, type2, type3);
    const chunkSize = readU32LE(bytes, offset + 4);
    const dataStart = offset + 8;

    if (chunkType === 'VP8X') {
      if (chunkSize >= 10 && dataStart + 10 <= bytes.length) {
        const width = readU24LE(bytes, dataStart + 4) + 1;
        const height = readU24LE(bytes, dataStart + 7) + 1;
        if (!isPlausibleDimensions(width, height)) return null;
        return { width, height };
      }
      return null;
    }

    if (chunkType === 'VP8 ') {
      // VP8 key frame header contains width/height.
      if (chunkSize >= 10 && dataStart + 10 <= bytes.length) {
        if (
          bytes[dataStart + 3] === 0x9d &&
          bytes[dataStart + 4] === 0x01 &&
          bytes[dataStart + 5] === 0x2a
        ) {
          const rawW = readU16LE(bytes, dataStart + 6);
          const rawH = readU16LE(bytes, dataStart + 8);
          const width = rawW & 0x3fff;
          const height = rawH & 0x3fff;
          if (!isPlausibleDimensions(width, height)) return null;
          return { width, height };
        }
      }
      return null;
    }

    if (chunkType === 'VP8L') {
      // Lossless bitstream header.
      if (chunkSize >= 5 && dataStart + 5 <= bytes.length) {
        if (bytes[dataStart] === 0x2f) {
          const packed = readU32LE(bytes, dataStart + 1);
          const width = (packed & 0x3fff) + 1;
          const height = ((packed >> 14) & 0x3fff) + 1;
          if (!isPlausibleDimensions(width, height)) return null;
          return { width, height };
        }
      }
      return null;
    }

    // Advance to next chunk; sizes are padded to even.
    const padded = chunkSize + (chunkSize % 2);
    offset = dataStart + padded;
  }

  return null;
}

function tryParseAvifDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  // AVIF is based on ISO BMFF. The most reliable dimension info is typically stored
  // in an Item Property box `ispe` (Image Spatial Extents): FullBox + width/height.
  // We do a bounded recursive box scan to find the first `ispe`.

  const MAX_DEPTH = 8;

  const containerTypes = new Set([
    'meta',
    'moov',
    'trak',
    'mdia',
    'minf',
    'stbl',
    'dinf',
    'udta',
    'iprp',
    'ipco',
    'ipro',
  ]);

  const findIspe = (
    start: number,
    end: number,
    depth: number
  ): { width: number; height: number } | null => {
    if (depth > MAX_DEPTH) return null;

    let offset = start;
    while (offset + 8 <= end) {
      const size32 = readU32BE(bytes, offset);
      const type = readAscii4(bytes, offset + 4);

      let headerSize = 8;
      let boxSize = size32;

      if (boxSize === 1) {
        // 64-bit size.
        if (offset + 16 > end) return null;
        const size64 = readU64BEAsNumber(bytes, offset + 8);
        if (!size64 || size64 < 16) return null;
        headerSize = 16;
        boxSize = size64;
      } else if (boxSize === 0) {
        // Extends to end of parent.
        boxSize = end - offset;
      }

      if (!Number.isFinite(boxSize) || boxSize < headerSize) return null;
      const boxEnd = offset + boxSize;
      if (boxEnd > end) return null;

      const dataStart = offset + headerSize;

      if (type === 'ispe') {
        // FullBox: version/flags (4) + width (4) + height (4)
        if (dataStart + 12 <= boxEnd) {
          const width = readU32BE(bytes, dataStart + 4);
          const height = readU32BE(bytes, dataStart + 8);
          if (!isPlausibleDimensions(width, height)) return null;
          return { width, height };
        }
        return null;
      }

      if (containerTypes.has(type)) {
        const childStart = type === 'meta' ? dataStart + 4 : dataStart;
        if (childStart < boxEnd) {
          const found = findIspe(childStart, boxEnd, depth + 1);
          if (found) return found;
        }
      }

      // Move to next box.
      if (boxSize <= 0) break;
      offset = boxEnd;
    }

    return null;
  };

  return findIspe(0, bytes.length, 0);
}

async function tryGetFastImageDimensions(
  file: File,
  format: string
): Promise<{ width: number; height: number } | null> {
  // Only attempt for formats we can parse reliably.
  if (!['png', 'jpeg', 'gif', 'bmp', 'webp', 'avif'].includes(format)) return null;

  const bytesToRead = Math.min(file.size, DIMENSION_PARSE_MAX_BYTES);
  if (bytesToRead <= 0) return null;
  const bytes = await readFileHeader(file, bytesToRead);

  switch (format) {
    case 'png':
      return tryParsePngDimensions(bytes);
    case 'jpeg':
      return tryParseJpegDimensions(bytes);
    case 'gif':
      return tryParseGifDimensions(bytes);
    case 'bmp':
      return tryParseBmpDimensions(bytes);
    case 'webp':
      return tryParseWebpDimensions(bytes);
    case 'avif':
      return tryParseAvifDimensions(bytes);
    default:
      return null;
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

  // Validation 4: Unsupported formats (HEIC/HEIF)
  if (detectedFormat === 'heic') {
    errors.push({
      type: 'browser_unsupported',
      message:
        'HEIC/HEIF format detected but not supported in most browsers. Please convert to JPEG, PNG, WebP, or AVIF first using an image editor or online converter.',
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

  // Validation 5: Unsupported formats (JPEG XL)
  if (detectedFormat === 'jxl') {
    errors.push({
      type: 'browser_unsupported',
      message:
        'JPEG XL format detected but not supported by browsers yet. Please convert to JPEG, PNG, WebP, or AVIF first.',
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

  // Validation 6: Unsupported formats (TIFF)
  if (detectedFormat === 'tiff') {
    errors.push({
      type: 'browser_unsupported',
      message:
        'TIFF format detected but not supported in browsers. Please convert to PNG, JPEG, or WebP first.',
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

  // Load image to get dimensions
  let dimensions: { width: number; height: number };
  let decodedBitmap: ImageBitmap | undefined;

  let avifDecodeUnavailable = false;

  const fastDimensions = await tryGetFastImageDimensions(file, detectedFormat);
  if (fastDimensions) {
    dimensions = fastDimensions;

    const maxSide = Math.max(dimensions.width, dimensions.height);
    const shouldDecodeBitmapForReuse =
      detectedFormat !== 'webp' &&
      detectedFormat !== 'avif' &&
      maxSide > DIMENSION_WARNING_PREPROCESSING;

    // Decode only when we expect immediate reuse for downscale.
    if (shouldDecodeBitmapForReuse && typeof createImageBitmap !== 'undefined') {
      try {
        decodedBitmap = await createImageBitmap(file);
      } catch {
        // If decoding fails here, still allow validation to proceed.
        // The conversion pipeline may still succeed via FFmpeg.
      }
    }
  } else {
    try {
      const loaded = await loadImageMetadata(file);
      dimensions = { width: loaded.width, height: loaded.height };
      decodedBitmap = loaded.bitmap;
    } catch (err) {
      if (detectedFormat === 'avif') {
        // Some browsers cannot decode AVIF via Canvas/Image APIs, but FFmpeg may still handle it.
        // Proceed with best-effort validation and let the conversion pipeline handle decoding.
        avifDecodeUnavailable = true;
        dimensions = { width: 0, height: 0 };
        decodedBitmap = undefined;
      } else {
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
    }
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

  // Validation 7: File size warning
  if (sizeBytes > SIZE_WARNING_THRESHOLD) {
    warnings.push({
      type: 'size',
      message: `Large file size (${(sizeBytes / 1024 / 1024).toFixed(1)}MB). Conversion may be slow and could fail on low-memory devices.`,
      severity: 'high',
    });
  }

  // Validation 8: Dimension warnings
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

  // Validation 9: WebP performance warning
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

  // Validation 10: AVIF performance warning
  if (detectedFormat === 'avif') {
    if (import.meta.env.DEV) {
      console.debug('[Validator] AVIF detected, adding performance warning');
    }

    warnings.push({
      type: 'avif_performance',
      message: avifDecodeUnavailable
        ? 'AVIF format detected. This browser could not decode AVIF for validation; conversion will fall back to FFmpeg decoding and may be slower.'
        : 'AVIF format detected. The image will be automatically converted to PNG first for better performance with FFmpeg.',
      severity: 'medium',
    });
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
