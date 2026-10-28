/**
 * gifenc v1.0.3 的最小类型声明（vendored JS 无自带 .d.ts）。
 * 只声明录屏器用到的三个导出；其余上游 API 未使用，不在此列出。
 */
export interface GIFEncoderWriteOptions {
  palette?: number[][]
  delay?: number
  repeat?: number
  first?: boolean
  transparent?: boolean
  transparentIndex?: number
  dispose?: number
  colorDepth?: number
}
export interface GIFEncoderInstance {
  reset(): void
  setDelay(centiseconds: number): void
  setRepeat(repeat: number): void
  writeFrame(index: Uint8Array, width: number, height: number, opts?: GIFEncoderWriteOptions): void
  finish(): void
  bytes(): Uint8Array
  bytesView(): Uint8Array
}
export function GIFEncoder(opts?: { auto?: boolean; initialCapacity?: number }): GIFEncoderInstance
export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, opts?: Record<string, unknown>): number[][]
export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: number[][], format?: string): Uint8Array
export function prequantize(rgba: Uint8Array | Uint8ClampedArray, opts?: Record<string, unknown>): void
