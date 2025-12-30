// Shared message protocol for the preprocessing worker.
// Keep this file free of DOM-specific types so it can be imported by both main and worker.

export type WorkerImageFormat = 'png' | 'jpeg';

export type PreprocessOp = 'transcode-to-png' | 'downscale';

export type WorkerInput = {
  buffer: ArrayBuffer;
  name: string;
  mimeType: string;
};

export type WorkerPreprocessPayload = {
  input: WorkerInput;
  op: PreprocessOp;
  maxDimension: number;
  outputFormat: WorkerImageFormat;
  quality: number;
  sourceWidth?: number;
  sourceHeight?: number;
};

export type WorkerPingMessage = {
  type: 'ping';
  id: number;
};

export type WorkerCancelMessage = {
  type: 'cancel';
  id: number;
};

export type WorkerPreprocessMessage = {
  type: 'preprocess';
  id: number;
  payload: WorkerPreprocessPayload;
};

export type WorkerRequestMessage =
  | WorkerPingMessage
  | WorkerCancelMessage
  | WorkerPreprocessMessage;

export type WorkerOutput = {
  buffer: ArrayBuffer;
  name: string;
  mimeType: string;
  width: number;
  height: number;
};

export type WorkerResultOkPayload = {
  didApply: boolean;
  output?: WorkerOutput;
};

export type WorkerResultOk = {
  type: 'result';
  id: number;
  ok: true;
  payload: WorkerResultOkPayload;
};

export type WorkerResultErr = {
  type: 'result';
  id: number;
  ok: false;
  payload: { error: string };
};

export type WorkerResponseMessage = WorkerResultOk | WorkerResultErr;
