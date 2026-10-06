import { BarcodeFormat, BinaryBitmap, DecodeHintType, HybridBinarizer, MultiFormatOneDReader, RGBLuminanceSource } from '@zxing/library';
import { barPatternWidth, validGtin } from './barcodeTypes';
import type { DecodedBarcode } from './barcodeTypes';

/** Decode luminance pixels locally. Explicit rotations cover vertical retail barcodes too. */
export function decodeBarcodePixels(rgba: Uint8ClampedArray, width: number, height: number): DecodedBarcode | undefined {
  const original = new Uint8ClampedArray(width * height);
  for (let i = 0; i < original.length; i++) original[i] = (rgba[i * 4] + 2 * rgba[i * 4 + 1] + rgba[i * 4 + 2]) / 4;
  const hints = new Map<DecodeHintType, unknown>([
    [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A]],
    [DecodeHintType.TRY_HARDER, true],
  ]);
  for (const rotated of [false, true]) {
    const w = rotated ? height : width;
    const h = rotated ? width : height;
    const pixels = rotated ? new Uint8ClampedArray(original.length) : original;
    if (rotated) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels[x * w + (height - 1 - y)] = original[y * width + x];
    for (const inverted of [false, true]) {
      const luminance = inverted ? pixels.map((value) => 255 - value) : pixels;
      const reader = new MultiFormatOneDReader(hints);
      try {
        const result = reader.decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(luminance, w, h))), hints);
        const value = result.getText();
        if (!validGtin(value)) continue;
        const format = BarcodeFormat[result.getBarcodeFormat()] as DecodedBarcode['format'];
        const points = result.getResultPoints().slice(0, 2).map((point) => rotated
          ? { x: point.getY(), y: height - 1 - point.getX() }
          : { x: point.getX(), y: point.getY() });
        return { value, format, points, widthPx: barPatternWidth(format, points) };
      } catch { /* A missing barcode is an ordinary result; continue other orientations. */ }
      finally { reader.reset(); }
    }
  }
}

if (typeof self !== 'undefined') self.onmessage = (event: MessageEvent<{ rgba: Uint8ClampedArray; width: number; height: number }>) => {
  try { self.postMessage({ barcode: decodeBarcodePixels(event.data.rgba, event.data.width, event.data.height) }); }
  catch { self.postMessage({ unavailable: true }); }
};
