export function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function isLikelyWasmAbort(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('aborted()') ||
    m.includes('abort(') ||
    m.includes('out of memory') ||
    m.includes('oom') ||
    (m.includes('memory') && m.includes('wasm'))
  );
}

export function isFfmpegNotLoadedError(message: string): boolean {
  return message.toLowerCase().includes('ffmpeg is not loaded');
}
