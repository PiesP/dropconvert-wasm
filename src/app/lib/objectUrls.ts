import type { ConvertResults } from '../../hooks/useFFmpeg';

export function revokeConvertResults(results: ConvertResults | null): void {
  if (!results) return;
  if (results.mp4.url) URL.revokeObjectURL(results.mp4.url);
  if (results.gif.url) URL.revokeObjectURL(results.gif.url);
}
