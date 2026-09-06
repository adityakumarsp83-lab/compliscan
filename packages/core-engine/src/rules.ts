import { OCRBlock, ParsedTokens, ComplianceReport, RuleCheckResult, MetricCalibration } from './types';
import { MetricFiducialEngine } from './metricFiducial';

export class LegalMetrologyEngine {
  public static parseTokens(blocks: OCRBlock[]): ParsedTokens {
    const tokens: ParsedTokens = {};
    for (const block of blocks) {
      const mrpMatch = block.text.match(/(?:MRP|M\.R\.P\.?)\s*[₹Rs\.]*\s*([\d,]+\.?\d*)/i);
      if (mrpMatch && !tokens.mrp) tokens.mrp = { value: parseFloat(mrpMatch[1]), rawText: block.text, box: block.boundingBox };

      const qtyMatch = block.text.match(/(\d+\.?\d*)\s*(g|kg|ml|l)/i);
      if (qtyMatch && !tokens.netQuantity) tokens.netQuantity = { value: parseFloat(qtyMatch[1]), unit: qtyMatch[2].toLowerCase(), rawText: block.text, box: block.boundingBox };

      const uspMatch = block.text.match(/(?:USP|UNIT\s*PRICE)\s*[₹Rs\.]*\s*([\d,]+\.?\d*)\s*(?:per|\/)\s*(g|kg|ml|l)/i);
      if (uspMatch && !tokens.usp) tokens.usp = { value: parseFloat(uspMatch[1]), unit: uspMatch[2].toLowerCase(), rawText: block.text, box: block.boundingBox };

      const fssaiMatch = block.text.match(/\b([12]\d{13})\b/);
      if (fssaiMatch && !tokens.fssaiLicense) tokens.fssaiLicense = { rawText: fssaiMatch[1], isValidFormat: true };
    }
    return tokens;
  }

  public static audit(tokens: ParsedTokens, calibration: MetricCalibration): ComplianceReport {
    const results: RuleCheckResult[] = [];

    // Rule 6(1)(e): MRP Check
    results.push({
      ruleId: "Rule 6(1)(e)",
      description: "MRP Declaration",
      status: tokens.mrp ? "PASS" : "FAIL",
      details: tokens.mrp ? `Found ₹${tokens.mrp.value}` : "Missing MRP"
    });

    // Rule 6(1)(c): Net Quantity Check
    results.push({
      ruleId: "Rule 6(1)(c)",
      description: "Net Quantity Declaration",
      status: tokens.netQuantity ? "PASS" : "FAIL",
      details: tokens.netQuantity ? `Found ${tokens.netQuantity.value} ${tokens.netQuantity.unit}` : "Missing Net Qty"
    });

    // Rule 6(11): Mathematical USP Calculation
    if (tokens.mrp && tokens.netQuantity) {
      const calculatedUSP = tokens.mrp.value / tokens.netQuantity.value;
      const isMatch = tokens.usp && Math.abs(calculatedUSP - tokens.usp.value) < 0.05;
      results.push({
        ruleId: "Rule 6(11)",
        description: "Unit Sale Price (USP) Math Verification",
        status: isMatch ? "PASS" : "FAIL",
        details: isMatch 
          ? `Printed ₹${tokens.usp?.value} matches calculated ₹${calculatedUSP.toFixed(2)}`
          : `Mismatch or missing USP. Expected: ₹${calculatedUSP.toFixed(2)}/${tokens.netQuantity.unit}`
      });
    }

    // Rule 7 Table I: Font Size Measurement via Barcode Reference
    if (tokens.mrp) {
      const fontMm = MetricFiducialEngine.calculateFontHeightMm(tokens.mrp.box.height, calibration);
      const minRequiredMm = (tokens.netQuantity?.value || 0) <= 200 ? 1.0 : 2.0;
      results.push({
        ruleId: "Rule 7 Table I",
        description: "Minimum Font Height Verification",
        status: fontMm >= minRequiredMm ? "PASS" : "FAIL",
        details: `Measured: ${fontMm}mm (Statutory Minimum: ${minRequiredMm}mm)`
      });
    }

    const passed = results.filter(r => r.status === "PASS").length;
    return { score: `${passed}/${results.length}`, results };
  }
}
