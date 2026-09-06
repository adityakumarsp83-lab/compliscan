import { MetricCalibration } from './types';
export const GS1_NOMINAL_WIDTH_MM = 37.29; // Standard EAN-13 physical barcode width

export class MetricFiducialEngine {
  public static calibrate(barcodeWidthPx: number): MetricCalibration {
    return {
      barcodeWidthPx,
      nominalBarcodeWidthMm: GS1_NOMINAL_WIDTH_MM,
      pixelsPerMm: barcodeWidthPx / GS1_NOMINAL_WIDTH_MM
    };
  }

  public static calculateFontHeightMm(glyphHeightPx: number, calibration: MetricCalibration): number {
    return parseFloat((glyphHeightPx / calibration.pixelsPerMm).toFixed(2));
  }
}
