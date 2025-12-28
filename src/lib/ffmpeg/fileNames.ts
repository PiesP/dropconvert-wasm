export function inferImageExtension(file: File): string {
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
    case 'image/heic':
    case 'image/heif':
      return 'heic';
    case 'image/jxl':
      return 'jxl';
    case 'image/tiff':
      return 'tiff';
    default:
      return 'img';
  }
}

export function inferSafeBaseName(file: File): string {
  // Preserve the original name for downloads as much as possible,
  // while avoiding characters that are problematic on common filesystems.
  const raw = file.name.trim();
  const withoutExt = raw.replace(/\.[^./\\]+$/, '');
  const base = (withoutExt || raw || 'output').trim();
  // Windows-incompatible characters: \ / : * ? " < > |
  return base.replace(/[\\/:*?"<>|]+/g, '_');
}
