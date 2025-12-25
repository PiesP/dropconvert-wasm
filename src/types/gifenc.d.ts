declare module 'gifenc' {
  export type Color = [number, number, number] | [number, number, number, number];
  export type Palette = Color[];

  export type QuantizeFormat = 'rgb565' | 'rgb444' | 'rgba4444';

  export interface QuantizeOptions {
    format?: QuantizeFormat;
    oneBitAlpha?: boolean | number;
    clearAlpha?: boolean;
    clearAlphaThreshold?: number;
    clearAlphaColor?: number;
  }

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: QuantizeOptions
  ): Palette;

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: Palette,
    format?: QuantizeFormat
  ): Uint8Array;

  export interface GIFEncoderOptions {
    auto?: boolean;
    initialCapacity?: number;
  }

  export interface WriteFrameOptions {
    palette?: Palette;
    first?: boolean;
    transparent?: boolean;
    transparentIndex?: number;
    delay?: number;
    repeat?: number;
    dispose?: number;
  }

  export interface GIFStream {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: WriteFrameOptions): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    reset(): void;
    writeHeader(): void;
    buffer: ArrayBuffer;
  }

  export function GIFEncoder(opts?: GIFEncoderOptions): GIFStream;
}
