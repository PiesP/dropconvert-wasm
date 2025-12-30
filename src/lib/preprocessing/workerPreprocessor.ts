// Worker-based image preprocessing.
// Uses ArrayBuffer transfer to avoid copying large inputs.

import type {
  PreprocessOp,
  WorkerImageFormat,
  WorkerRequestMessage,
  WorkerResponseMessage,
} from '../../workers/preprocess.protocol';

export type { WorkerImageFormat };

export type WorkerPreprocessOptions = {
  op: PreprocessOp;
  maxDimension: number;
  outputFormat: WorkerImageFormat;
  quality: number;
  sourceWidth?: number;
  sourceHeight?: number;
};

function isWorkerSupported(): boolean {
  return (
    typeof Worker !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined' &&
    typeof createImageBitmap !== 'undefined'
  );
}

let workerRef: Worker | null = null;
let nextId = 1;

const pending = new Map<
  number,
  {
    resolve: (payload: Extract<WorkerResponseMessage, { ok: true }>['payload']) => void;
    reject: (err: Error) => void;
  }
>();

function resetWorker(err: Error) {
  if (workerRef) {
    try {
      workerRef.terminate();
    } catch {
      // Ignore.
    }
  }
  workerRef = null;

  for (const [, p] of pending) {
    p.reject(err);
  }
  pending.clear();
}

function getWorker(): Worker {
  if (workerRef) return workerRef;

  const worker = new Worker(new URL('../../workers/preprocess.worker.ts', import.meta.url), {
    type: 'module',
  });

  worker.onmessage = (evt: MessageEvent<WorkerResponseMessage>) => {
    const msg = evt.data;
    if (msg.type !== 'result') return;

    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);

    if (msg.ok) {
      p.resolve(msg.payload);
    } else {
      p.reject(new Error(msg.payload.error));
    }
  };

  worker.onerror = () => {
    resetWorker(new Error('Preprocess worker crashed.'));
  };

  workerRef = worker;
  return worker;
}

export function canPreprocessInWorker(): boolean {
  return isWorkerSupported();
}

export function warmupPreprocessWorker(): void {
  if (!isWorkerSupported()) return;
  try {
    const worker = getWorker();
    // Fire-and-forget ping to ensure the worker is initialized.
    const msg: WorkerRequestMessage = { type: 'ping', id: 0 };
    worker.postMessage(msg);
  } catch {
    // Ignore warmup failures.
  }
}

export function cleanupPreprocessWorker(): void {
  if (!workerRef && pending.size === 0) return;
  resetWorker(new Error('Preprocess worker terminated.'));
}

export async function preprocessFileInWorker(
  file: File,
  options: WorkerPreprocessOptions,
  abortSignal?: AbortSignal
): Promise<File | null> {
  if (!isWorkerSupported()) return null;

  if (abortSignal?.aborted) {
    throw new Error('Conversion cancelled by user');
  }

  const id = nextId++;
  const worker = getWorker();

  const onAbort = () => {
    try {
      const cancelMsg: WorkerRequestMessage = { type: 'cancel', id };
      worker.postMessage(cancelMsg);
    } catch {
      // Ignore.
    }
    // Best-effort: terminate the worker to stop heavy decode/resize work.
    // This also rejects all pending requests deterministically.
    resetWorker(new Error('Conversion cancelled by user'));
  };

  abortSignal?.addEventListener('abort', onAbort);

  try {
    const buffer = await file.arrayBuffer();

    if (abortSignal?.aborted) {
      throw new Error('Conversion cancelled by user');
    }

    const payload: Extract<WorkerRequestMessage, { type: 'preprocess' }>['payload'] = {
      input: {
        buffer,
        name: file.name,
        mimeType: file.type,
      },
      op: options.op,
      maxDimension: options.maxDimension,
      outputFormat: options.outputFormat,
      quality: options.quality,
      ...(options.sourceWidth ? { sourceWidth: options.sourceWidth } : {}),
      ...(options.sourceHeight ? { sourceHeight: options.sourceHeight } : {}),
    };

    const req: WorkerRequestMessage = { type: 'preprocess', id, payload };

    const result = await new Promise<Extract<WorkerResponseMessage, { ok: true }>['payload']>(
      (resolve, reject) => {
        pending.set(id, { resolve, reject });
        try {
          // Transfer the input buffer to avoid copying.
          worker.postMessage(req, [buffer]);
        } catch (err) {
          pending.delete(id);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      }
    );

    if (!result.didApply || !result.output) return null;

    const out = result.output;
    const blob = new Blob([out.buffer], { type: out.mimeType });
    return new File([blob], out.name, { type: out.mimeType });
  } finally {
    abortSignal?.removeEventListener('abort', onAbort);
  }
}
