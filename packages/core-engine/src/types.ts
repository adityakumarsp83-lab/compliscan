export interface BoundingBox { x: number; y: number; width: number; height: number; }
export interface OCRBlock { text: string; boundingBox: BoundingBox; }
export interface MetricCalibration { barcodeWidthPx: number; nominalBarcodeWidthMm: number; pixelsPerMm: number; }
export interface ParsedTokens {
  mrp?: { value: number; rawText: string; box: BoundingBox };
  netQuantity?: { value: number; unit: string; rawText: string; box: BoundingBox };
  usp?: { value: number; unit: string; rawText: string; box: BoundingBox };
  fssaiLicense?: { rawText: string; isValidFormat: boolean };
}
export interface RuleCheckResult { ruleId: string; description: string; status: 'PASS' | 'FAIL'; details: string; }
export interface ComplianceReport { score: string; results: RuleCheckResult[]; }
