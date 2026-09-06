export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OCRBlock {
  text: string;
  boundingBox: BoundingBox;
}

export interface MetricCalibration {
  barcodeWidthPx: number;
  nominalBarcodeWidthMm: number;
  pixelsPerMm: number;
}

export interface ParsedTokens {
  mrp?: { value: number; rawText: string; box: BoundingBox };
  netQuantity?: { value: number; unit: string; rawText: string; box: BoundingBox };
  usp?: { value: number; unit: string; rawText: string; box: BoundingBox };
  fssaiLicense?: { rawText: string; isValidFormat: boolean };
  consumerCare?: { rawText: string };
  countryOfOrigin?: { rawText: string };
}

export interface RuleCheckResult {
  ruleId: string;
  description: string;
  status: 'PASS' | 'FAIL';
  details: string;
}

export interface ComplianceReport {
  score: string;
  results: RuleCheckResult[];
}

export const GS1_NOMINAL_WIDTH_MM = 37.29; // Standard GS1 EAN-13 physical barcode width

export class MetricFiducialEngine {
  public static calibrate(barcodeWidthPx: number): MetricCalibration {
    return {
      barcodeWidthPx,
      nominalBarcodeWidthMm: GS1_NOMINAL_WIDTH_MM,
      pixelsPerMm: barcodeWidthPx / GS1_NOMINAL_WIDTH_MM,
    };
  }

  public static calculateFontHeightMm(glyphHeightPx: number, calibration: MetricCalibration): number {
    return parseFloat((glyphHeightPx / calibration.pixelsPerMm).toFixed(2));
  }
}

export class LegalMetrologyEngine {
  public static parseTokens(blocks: OCRBlock[]): ParsedTokens {
    const tokens: ParsedTokens = {};
    const fullText = blocks.map(b => b.text).join('\n');

    for (const block of blocks) {
      const mrpMatch = block.text.match(/(?:MRP|M\.R\.P\.?)\s*[₹Rs\.]*\s*([\d,]+\.?\d*)/i);
      if (mrpMatch && !tokens.mrp) {
        tokens.mrp = { value: parseFloat(mrpMatch[1]), rawText: block.text, box: block.boundingBox };
      }

      const qtyMatch = block.text.match(/(\d+\.?\d*)\s*(g|kg|ml|l)/i);
      if (qtyMatch && !tokens.netQuantity) {
        tokens.netQuantity = { value: parseFloat(qtyMatch[1]), unit: qtyMatch[2].toLowerCase(), rawText: block.text, box: block.boundingBox };
      }

      const uspMatch = block.text.match(/(?:USP|UNIT\s*PRICE)\s*[₹Rs\.]*\s*([\d,]+\.?\d*)\s*(?:per|\/)\s*(g|kg|ml|l)/i);
      if (uspMatch && !tokens.usp) {
        tokens.usp = { value: parseFloat(uspMatch[1]), unit: uspMatch[2].toLowerCase(), rawText: block.text, box: block.boundingBox };
      }

      const fssaiMatch = block.text.match(/\b([12]\d{13})\b/);
      if (fssaiMatch && !tokens.fssaiLicense) {
        tokens.fssaiLicense = { rawText: fssaiMatch[1], isValidFormat: true };
      }
    }

    if (/Customer Care|care@|1800/i.test(fullText)) {
      tokens.consumerCare = { rawText: "Detected" };
    }
    if (/Country of Origin|Made in India|Product of/i.test(fullText)) {
      tokens.countryOfOrigin = { rawText: "Detected" };
    }

    return tokens;
  }

  public static audit(tokens: ParsedTokens, calibration: MetricCalibration): ComplianceReport {
    const results: RuleCheckResult[] = [];

    // Rule 6(1)(e): MRP
    results.push({
      ruleId: "Rule 6(1)(e)",
      description: "MRP Declaration",
      status: tokens.mrp ? "PASS" : "FAIL",
      details: tokens.mrp ? `Found ₹${tokens.mrp.value}` : "Missing MRP",
    });

    // Rule 6(1)(c): Net Quantity
    results.push({
      ruleId: "Rule 6(1)(c)",
      description: "Net Quantity Declaration",
      status: tokens.netQuantity ? "PASS" : "FAIL",
      details: tokens.netQuantity ? `Found ${tokens.netQuantity.value} ${tokens.netQuantity.unit}` : "Missing Net Qty",
    });

    // Rule 6(11): Exact USP Math Check
    if (tokens.mrp && tokens.netQuantity) {
      const calculatedUSP = tokens.mrp.value / tokens.netQuantity.value;
      const isMatch = tokens.usp && Math.abs(calculatedUSP - tokens.usp.value) < 0.05;
      results.push({
        ruleId: "Rule 6(11)",
        description: "Unit Sale Price (USP) Math Verification",
        status: isMatch ? "PASS" : "FAIL",
        details: isMatch
          ? `Printed ₹${tokens.usp?.value} matches calculated ₹${calculatedUSP.toFixed(2)}`
          : `Mismatch or missing USP. Expected: ₹${calculatedUSP.toFixed(2)}/${tokens.netQuantity.unit}`,
      });
    }

    // Rule 6(1)(n): Consumer Care
    results.push({
      ruleId: "Rule 6(1)(n)",
      description: "Consumer Care Details",
      status: tokens.consumerCare ? "PASS" : "FAIL",
      details: tokens.consumerCare ? "Present" : "Missing consumer contact details",
    });

    // Rule 7 Table I: Font Size Check via Barcode Scale Ratio
    if (tokens.mrp) {
      const fontMm = MetricFiducialEngine.calculateFontHeightMm(tokens.mrp.box.height, calibration);
      const minRequiredMm = (tokens.netQuantity?.value || 0) <= 200 ? 1.0 : 2.0;
      results.push({
        ruleId: "Rule 7 Table I",
        description: "Minimum Font Height Verification",
        status: fontMm >= minRequiredMm ? "PASS" : "FAIL",
        details: `Measured: ${fontMm}mm (Statutory Minimum: ${minRequiredMm}mm)`,
      });
    }

    const passed = results.filter(r => r.status === "PASS").length;
    return { score: `${passed}/${results.length}`, results };
  }
}
