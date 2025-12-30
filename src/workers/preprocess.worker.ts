/// <reference lib="webworker" />

// Image preprocessing worker.
// Accepts input as ArrayBuffer (transferable) and outputs preprocessed image bytes.

import type {
  WorkerPreprocessMessage,
  WorkerRequestMessage,
  WorkerResponseMessage,
  WorkerResultOkPayload,
} from './preprocess.protocol';

import type { WorkerImageFormat } from './preprocess.protocol';

const cancelled = new Set<number>();

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

function isCancelled(id: number): boolean {
  return cancelled.has(id);
}

async function decodeToBitmap(
  blob: Blob,
  resizeTo?: { width: number; height: number }
): Promise<ImageBitmap> {
  if (resizeTo) {
    // Some browsers support resize during decode, which avoids a second resample pass.
    try {
      return await createImageBitmap(blob, {
        resizeWidth: resizeTo.width,
        resizeHeight: resizeTo.height,
        resizeQuality: 'high',
      });
    } catch {
      // Fall back to decode without resize.
    }
  }
  return createImageBitmap(blob);
}

async function bitmapToBlob(
  bitmap: ImageBitmap,
  output: { width: number; height: number },
  format: WorkerImageFormat,
  quality: number
): Promise<Blob> {
  const canvas = new OffscreenCanvas(output.width, output.height);
  const ctx = canvas.getContext('2d', { alpha: true }) as OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('Failed to get 2D context from OffscreenCanvas');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, output.width, output.height);

  const type = format === 'png' ? 'image/png' : 'image/jpeg';
  // For PNG, quality is ignored by most implementations.
  return canvas.convertToBlob({ type, quality });
}

async function preprocessInWorker(
  id: number,
  payload: WorkerPreprocessMessage['payload']
): Promise<WorkerResultOkPayload> {
  if (isCancelled(id)) throw new Error('Cancelled');

  const { input, op, maxDimension, outputFormat, quality, sourceWidth, sourceHeight } = payload;

  const inputMime = input.mimeType || 'application/octet-stream';
  const inputBlob = new Blob([input.buffer], { type: inputMime });

  // If we know source dimensions, decide scaling before decoding.
  const wanted = (() => {
    if (!sourceWidth || !sourceHeight) return null;
    const fitted = fitWithinMaxDimension(sourceWidth, sourceHeight, maxDimension);
    return fitted.didScale ? fitted : null;
  })();

  if (op === 'downscale' && sourceWidth && sourceHeight) {
    const maxSide = Math.max(sourceWidth, sourceHeight);
    if (Number.isFinite(maxSide) && maxSide > 0 && maxSide <= maxDimension) {
      return { didApply: false };
    }
  }

  if (isCancelled(id)) throw new Error('Cancelled');

  const bitmap = await decodeToBitmap(
    inputBlob,
    wanted ? { width: wanted.width, height: wanted.height } : undefined
  );

  try {
    if (isCancelled(id)) throw new Error('Cancelled');

    const outputSize = (() => {
      if (op === 'transcode-to-png') {
        const fitted = fitWithinMaxDimension(bitmap.width, bitmap.height, maxDimension);
        return { width: fitted.width, height: fitted.height, didScale: fitted.didScale };
      }

      const fitted = fitWithinMaxDimension(bitmap.width, bitmap.height, maxDimension);
      return fitted;
    })();

    if (op === 'downscale' && !outputSize.didScale) {
      return { didApply: false };
    }

    const effectiveFormat: WorkerImageFormat = op === 'transcode-to-png' ? 'png' : outputFormat;

    const blob = await bitmapToBlob(
      bitmap,
      { width: outputSize.width, height: outputSize.height },
      effectiveFormat,
      quality
    );

    const outBuffer = await blob.arrayBuffer();

    const baseName = input.name.replace(/\.[^./\\]+$/, '') || 'image';
    const suffix = op === 'transcode-to-png' ? '_transcoded' : '_preprocessed';
    const ext = effectiveFormat === 'png' ? 'png' : 'jpeg';
    const name = `${baseName}${suffix}.${ext}`;

    return {
      didApply: true,
      output: {
        buffer: outBuffer,
        name,
        mimeType: blob.type,
        width: outputSize.width,
        height: outputSize.height,
      },
    };
  } finally {
    try {
      bitmap.close();
    } catch {
      // Ignore.
    }
  }
}

function postOk(id: number, payload: WorkerResultOkPayload, transfer?: Transferable[]) {
  const msg: WorkerResponseMessage = { type: 'result', id, ok: true, payload };
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer ?? []);
}

function postErr(id: number, error: unknown) {
  const msg: WorkerResponseMessage = {
    type: 'result',
    id,
    ok: false,
    payload: { error: error instanceof Error ? error.message : String(error) },
  };
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);
}

(self as unknown as DedicatedWorkerGlobalScope).onmessage = async (
  evt: MessageEvent<WorkerRequestMessage>
) => {
  const msg = evt.data;

  if (msg.type === 'ping') {
    postOk(msg.id, { didApply: false });
    return;
  }

  if (msg.type === 'cancel') {
    cancelled.add(msg.id);
    return;
  }

  if (msg.type !== 'preprocess') return;

  try {
    const result = await preprocessInWorker(msg.id, msg.payload);
    if (result.didApply && result.output) {
      postOk(msg.id, result, [result.output.buffer]);
    } else {
      postOk(msg.id, result);
    }
  } catch (err) {
    postErr(msg.id, err);
  } finally {
    cancelled.delete(msg.id);
  }
};
