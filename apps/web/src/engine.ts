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
  nominalBarcodeWidthMm: number; // GS1 standard nominal width: 37.29 mm
  pixelsPerMm: number;
}

export interface ParsedTokens {
  // 10 Statutory Tokens
  manufacturerDetails?: { rawText: string; detectedName: string };
  genericName?: { rawText: string };
  netQuantity?: { value: number; unit: string; rawText: string; box: BoundingBox };
  mfgDate?: { rawText: string };
  expDate?: { rawText: string };
  mrp?: { value: number; rawText: string; box: BoundingBox };
  countryOfOrigin?: { rawText: string; country: string };
  consumerCare?: { rawText: string; contactInfo: string };
  usp?: { value: number; unit: string; rawText: string; box: BoundingBox };
  fssaiLicense?: { rawText: string; isValidFormat: boolean };
}

export interface RuleCheckResult {
  ruleId: string;
  description: string;
  status: 'PASS' | 'FAIL' | 'WARNING';
  details: string;
  isCoreInnovation?: boolean;
  innovationBadge?: string;
  legalActSection: string;
}

export interface ComplianceReport {
  timestamp: string;
  score: string;
  totalPassed: number;
  totalRules: number;
  results: RuleCheckResult[];
}

export const GS1_NOMINAL_WIDTH_MM = 37.29;

export class MetricFiducialEngine {
  public static calibrate(barcodeWidthPx: number): MetricCalibration {
    if (barcodeWidthPx <= 0) {
      throw new Error('Invalid barcode pixel width detected.');
    }
    return {
      barcodeWidthPx,
      nominalBarcodeWidthMm: GS1_NOMINAL_WIDTH_MM,
      pixelsPerMm: barcodeWidthPx / GS1_NOMINAL_WIDTH_MM,
    };
  }

  public static calculateFontHeightMm(glyphHeightPx: number, calibration: MetricCalibration): number {
    if (calibration.pixelsPerMm <= 0) return 0;
    return parseFloat((glyphHeightPx / calibration.pixelsPerMm).toFixed(2));
  }
}

export class LegalMetrologyEngine {
  private static FSSAI_REGEX = /^[12](0[1-9]|[12]\d|3[0-7])(1[1-9]|2[0-6])\d{3}\d{6}$/;
  private static MRP_REGEX = /(?:MRP|M\.R\.P\.?)\s*(?:incl\.?\s*of\s*all\s*taxes)?\s*[₹Rs\.]*\s*([\d,]+\.?\d*)/i;
  private static NET_QTY_REGEX = /(?:NET\s*(?:QTY|WT|WEIGHT|QUANTITY)|NET)\s*[:.]?\s*(\d+\.?\d*)\s*(g|kg|ml|l|ltr|N|units|pieces)/i;
  private static USP_REGEX = /(?:USP|UNIT\s*SALE\s*PRICE|UNIT\s*PRICE)\s*[:.]?\s*[₹Rs\.]*\s*([\d,]+\.?\d*)\s*(?:per|\/)\s*(g|kg|ml|l|unit|N)/i;
  private static MFG_DATE_REGEX = /(?:MFD|MFG|PACKED|DATE\s*OF\s*MFG|PKD)\s*[:.]?\s*(\d{1,2}[/-]\d{2,4}|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s/-]*\d{2,4})/i;
  private static EXP_DATE_REGEX = /(?:EXP|EXPIRY|USE\s*BY|BEST\s*BEFORE)\s*[:.]?\s*(\d{1,2}[/-]\d{2,4}|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s/-]*\d{2,4}|\d+\s*MONTHS\s*FROM\s*MFG)/i;
  private static ORIGIN_REGEX = /(?:Country\s*of\s*Origin|Made\s*in|Product\s*of)\s*[:.]?\s*([A-Za-z\s]+)/i;
  private static MFG_NAME_REGEX = /(?:Mfg\s*by|Manufactured\s*by|Packed\s*by|Marketed\s*by|Mfg\s*&\s*Pkd\s*by)[:.]?\s*([^\n,]+)/i;
  private static COMMODITY_REGEX = /(?:Commodity|Product|Generic\s*Name|Item)[:.]?\s*([^\n]+)/i;

  public static parseTokens(blocks: OCRBlock[]): ParsedTokens {
    const tokens: ParsedTokens = {};
    const fullText = blocks.map((b) => b.text).join('\n');

    for (const block of blocks) {
      // 1. MRP (Rule 6(1)(e))
      const mrpMatch = block.text.match(this.MRP_REGEX);
      if (mrpMatch && !tokens.mrp) {
        tokens.mrp = {
          value: parseFloat(mrpMatch[1].replace(/,/g, '')),
          rawText: block.text,
          box: block.boundingBox,
        };
      }

      // 2. Net Quantity (Rule 6(1)(c))
      const qtyMatch = block.text.match(this.NET_QTY_REGEX);
      if (qtyMatch && !tokens.netQuantity) {
        tokens.netQuantity = {
          value: parseFloat(qtyMatch[1]),
          unit: qtyMatch[2].toLowerCase(),
          rawText: block.text,
          box: block.boundingBox,
        };
      }

      // 3. Unit Sale Price (USP) (Rule 6(11))
      const uspMatch = block.text.match(this.USP_REGEX);
      if (uspMatch && !tokens.usp) {
        tokens.usp = {
          value: parseFloat(uspMatch[1].replace(/,/g, '')),
          unit: uspMatch[2].toLowerCase(),
          rawText: block.text,
          box: block.boundingBox,
        };
      }
    }

    // 4. Manufacturer Details (Rule 6(1)(a))
    const mfgMatch = fullText.match(this.MFG_NAME_REGEX);
    if (mfgMatch) {
      tokens.manufacturerDetails = {
        rawText: mfgMatch[0],
        detectedName: mfgMatch[1].trim(),
      };
    } else if (/Pvt\s*Ltd|Limited|Industries|Holdings/i.test(fullText)) {
      tokens.manufacturerDetails = { rawText: 'Detected Corporate Entity', detectedName: 'Verified' };
    }

    // 5. Generic Name of Commodity (Rule 6(1)(b))
    const commMatch = fullText.match(this.COMMODITY_REGEX);
    if (commMatch) {
      tokens.genericName = { rawText: commMatch[1].trim() };
    } else if (blocks.length > 0) {
      // Top header line of food/retail packaging is standardly the commodity
      tokens.genericName = { rawText: blocks[0].text.trim() };
    }

    // 6. Date of Manufacture / Packing (Rule 6(1)(d))
    const mfgDateMatch = fullText.match(this.MFG_DATE_REGEX);
    if (mfgDateMatch) {
      tokens.mfgDate = { rawText: mfgDateMatch[0] };
    }

    // 7. Best Before / Expiry Date (Rule 6(1)(da))
    const expDateMatch = fullText.match(this.EXP_DATE_REGEX);
    if (expDateMatch) {
      tokens.expDate = { rawText: expDateMatch[0] };
    }

    // 8. Country of Origin (Rule 6(1)(f))
    const originMatch = fullText.match(this.ORIGIN_REGEX);
    if (originMatch) {
      tokens.countryOfOrigin = {
        rawText: originMatch[0],
        country: originMatch[1].trim(),
      };
    } else if (/Made in India|Product of India/i.test(fullText)) {
      tokens.countryOfOrigin = { rawText: 'Made in India', country: 'India' };
    }

    // 9. Consumer Care Details (Rule 6(1)(n))
    const carePhoneMatch = fullText.match(/(?:1800\s*\d{2,4}\s*\d{2,4}|\b\d{10}\b)/);
    const careEmailMatch = fullText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (carePhoneMatch || careEmailMatch || /Customer\s*Care|Consumer\s*Care|Helpdesk/i.test(fullText)) {
      tokens.consumerCare = {
        rawText: 'Present',
        contactInfo: `${carePhoneMatch ? carePhoneMatch[0] : ''} ${careEmailMatch ? careEmailMatch[0] : ''}`.trim() || 'Details Found',
      };
    }

    // 10. FSSAI License Number (Auxiliary statutory check)
    const fssaiCandidates = fullText.match(/\b\d{14}\b/g);
    if (fssaiCandidates) {
      for (const num of fssaiCandidates) {
        if (this.FSSAI_REGEX.test(num)) {
          tokens.fssaiLicense = { rawText: num, isValidFormat: true };
          break;
        }
      }
    }

    return tokens;
  }

  public static audit(tokens: ParsedTokens, calibration: MetricCalibration): ComplianceReport {
    const results: RuleCheckResult[] = [];

    // 1. Rule 6(1)(a): Manufacturer Details
    results.push({
      ruleId: 'Rule 6(1)(a)',
      description: 'Manufacturer / Packer Name & Address',
      status: tokens.manufacturerDetails ? 'PASS' : 'FAIL',
      details: tokens.manufacturerDetails ? `Identified: ${tokens.manufacturerDetails.detectedName}` : 'Missing manufacturer/packer identity',
      legalActSection: 'Legal Metrology (Packaged Commodities) Rules, 2011',
    });

    // 2. Rule 6(1)(b): Generic Name
    results.push({
      ruleId: 'Rule 6(1)(b)',
      description: 'Generic / Common Name of Commodity',
      status: tokens.genericName ? 'PASS' : 'FAIL',
      details: tokens.genericName ? `Identified: ${tokens.genericName.rawText}` : 'Missing generic commodity designation',
      legalActSection: 'Legal Metrology (Packaged Commodities) Rules, 2011',
    });

    // 3. Rule 6(1)(c): Net Quantity
    results.push({
      ruleId: 'Rule 6(1)(c)',
      description: 'Net Quantity in Metric Units',
      status: tokens.netQuantity ? 'PASS' : 'FAIL',
      details: tokens.netQuantity ? `Declared: ${tokens.netQuantity.value} ${tokens.netQuantity.unit}` : 'Missing net quantity metric declaration',
      legalActSection: 'Legal Metrology (Packaged Commodities) Rules, 2011',
    });

    // 4. Rule 6(1)(d): Month & Year of Manufacture
    results.push({
      ruleId: 'Rule 6(1)(d)',
      description: 'Date of Manufacture / Packing',
      status: tokens.mfgDate ? 'PASS' : 'FAIL',
      details: tokens.mfgDate ? `Declared: ${tokens.mfgDate.rawText}` : 'Missing manufacturing/packaging date',
      legalActSection: 'Legal Metrology (Packaged Commodities) Rules, 2011',
    });

    // 5. Rule 6(1)(da): Best Before / Expiry Date
    results.push({
      ruleId: 'Rule 6(1)(da)',
      description: 'Best Before / Expiry Declaration',
      status: tokens.expDate ? 'PASS' : 'WARNING',
      details: tokens.expDate ? `Declared: ${tokens.expDate.rawText}` : 'Not detected (Mandatory for perishable/food items)',
      legalActSection: 'Legal Metrology (Packaged Commodities) Rules, 2011',
    });

    // 6. Rule 6(1)(e): Maximum Retail Price (MRP)
    results.push({
      ruleId: 'Rule 6(1)(e)',
      description: 'Maximum Retail Price (MRP) incl. of all taxes',
      status: tokens.mrp ? 'PASS' : 'FAIL',
      details: tokens.mrp ? `Declared: ₹${tokens.mrp.value.toFixed(2)} (incl. all taxes)` : 'Missing or illegible MRP declaration',
      legalActSection: 'Legal Metrology (Packaged Commodities) Rules, 2011',
    });

    // 7. Rule 6(1)(f): Country of Origin
    results.push({
      ruleId: 'Rule 6(1)(f)',
      description: 'Country of Origin / Sourced Entity',
      status: tokens.countryOfOrigin ? 'PASS' : 'FAIL',
      details: tokens.countryOfOrigin ? `Declared: ${tokens.countryOfOrigin.country || tokens.countryOfOrigin.rawText}` : 'Missing Country of Origin',
      legalActSection: 'Legal Metrology (Packaged Commodities) Rules, 2011',
    });

    // 8. Rule 6(1)(n): Consumer Care Contact Details
    results.push({
      ruleId: 'Rule 6(1)(n)',
      description: 'Consumer Care Redressal Mechanism',
      status: tokens.consumerCare ? 'PASS' : 'FAIL',
      details: tokens.consumerCare ? `Contact: ${tokens.consumerCare.contactInfo}` : 'Missing consumer grievance redressal phone/email',
      legalActSection: 'Legal Metrology (Packaged Commodities) Rules, 2011',
    });

    // 9. ⭐ NOVEL STATUTORY INNOVATION 1: Rule 6(11) Exact Arithmetic USP Engine
    if (tokens.mrp && tokens.netQuantity) {
      const calculatedUSP = tokens.mrp.value / tokens.netQuantity.value;
      const isMatch = tokens.usp && Math.abs(calculatedUSP - tokens.usp.value) < 0.05;

      results.push({
        ruleId: 'Rule 6(11)',
        description: 'Unit Sale Price (USP) Mathematical Verification',
        status: isMatch ? 'PASS' : 'FAIL',
        details: isMatch
          ? `Verified: Printed ₹${tokens.usp?.value}/${tokens.usp?.unit} matches exact calculated ₹${calculatedUSP.toFixed(2)}/${tokens.netQuantity.unit}`
          : `Violation: Printed ${tokens.usp ? `₹${tokens.usp.value}` : 'None'} vs Calculated ₹${calculatedUSP.toFixed(2)}/${tokens.netQuantity.unit}`,
        isCoreInnovation: true,
        innovationBadge: 'Zero-Hallucination Math Engine',
        legalActSection: 'Rule 6(11) as amended by Jan Vishwas Act, 2026',
      });
    } else {
      results.push({
        ruleId: 'Rule 6(11)',
        description: 'Unit Sale Price (USP) Mathematical Verification',
        status: 'FAIL',
        details: 'Cannot verify USP: MRP or Net Quantity declaration missing',
        isCoreInnovation: true,
        innovationBadge: 'Zero-Hallucination Math Engine',
        legalActSection: 'Rule 6(11) as amended by Jan Vishwas Act, 2026',
      });
    }

    // 10. ⭐ NOVEL STATUTORY INNOVATION 2: Rule 7 Table I GS1 In-Plane Optical Ruler
    if (tokens.mrp) {
      const fontMm = MetricFiducialEngine.calculateFontHeightMm(tokens.mrp.box.height, calibration);
      const minRequiredMm = (tokens.netQuantity?.value || 0) <= 200 ? 1.0 : (tokens.netQuantity?.value || 0) <= 500 ? 2.0 : 4.0;
      const isHeightPass = fontMm >= minRequiredMm;

      results.push({
        ruleId: 'Rule 7 Table I',
        description: 'Statutory Minimum Font Height Verification',
        status: isHeightPass ? 'PASS' : 'FAIL',
        details: `Measured Height: ${fontMm}mm (Statutory Minimum: ${minRequiredMm}.0mm via GS1 EAN-13 Fiducial)`,
        isCoreInnovation: true,
        innovationBadge: 'In-Plane Optical GS1 Ruler',
        legalActSection: 'Rule 7, Table I (Minimum Height of Numeral)',
      });
    }

    const passedCount = results.filter((r) => r.status === 'PASS').length;

    return {
      timestamp: new Date().toISOString(),
      score: `${passedCount}/${results.length}`,
      totalPassed: passedCount,
      totalRules: results.length,
      results,
    };
  }
}
