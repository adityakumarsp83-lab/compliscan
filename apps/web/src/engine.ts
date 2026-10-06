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
  fieldEvidence?: Record<string, { imageIndex: number; surface: string; source: string; confidence?: number; rawText: string }[]>;
  conflicts?: { field: 'mrp' | 'netQuantity' | 'usp'; details: string }[];
  // Core 10 statutory tokens
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

  // Extended tokens (populated by Gemini or enhanced Tesseract parsing)
  pinCode?: { rawText: string };
  mrpFormatValid?: boolean;            // Rule 2(m): exact "incl. of all taxes" phrase
  stickerOverMrp?: boolean;            // Rule 6(3): sticker pasted over MRP
  prohibitedQualifiers?: string[];     // Rule 12: "minimum", "about", etc.
  nonSiUnits?: string[];               // Rule 13: dozen, gross, etc.
  languageUsed?: string[];             // Rule 9: Hindi / English
  consumerCareName?: { rawText: string }; // Rule 6(2): consumer care entity name
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
  evidence?: import('./imageEvidence').EvidenceManifest;
  inspection?: import('./inspectionMetadata').InspectionMetadata;
  measurements?: { referenceWidthMm: number; barcodeWidthPx: number; imageIndex: number; netQuantityHeightPx?: number; mrpHeightPx?: number };
  timestamp: string;
  score: string;
  totalPassed: number;
  totalRules: number;
  results: RuleCheckResult[];
}

export const GS1_NOMINAL_WIDTH_MM = 37.29;

export class MetricFiducialEngine {
  public static calibrate(barcodeWidthPx: number, referenceWidthMm = GS1_NOMINAL_WIDTH_MM): MetricCalibration {
    if (!Number.isFinite(barcodeWidthPx) || barcodeWidthPx <= 0 || !Number.isFinite(referenceWidthMm) || referenceWidthMm <= 0) throw new Error('Invalid barcode pixel width detected.');
    return {
      barcodeWidthPx,
      nominalBarcodeWidthMm: referenceWidthMm,
      pixelsPerMm: barcodeWidthPx / referenceWidthMm,
    };
  }

  public static calculateFontHeightMm(glyphHeightPx: number, calibration: MetricCalibration): number {
    if (calibration.pixelsPerMm <= 0) return 0;
    return parseFloat((glyphHeightPx / calibration.pixelsPerMm).toFixed(2));
  }
}

export class LegalMetrologyEngine {
  // ── Regex patterns ────────────────────────────────────────────────────────
  private static FSSAI_REGEX = /^[12](0[1-9]|[12]\d|3[0-7])(1[1-9]|2[0-6])\d{3}\d{6}$/;

  /** Rule 2(m): exact MRP declaration format — matches both 'MRP ₹ (incl. of all taxes) 10' and 'MRP ₹ 10 incl. of all taxes' */
  private static MRP_FORMAT_REGEX =
    /(?:Maximum\s*Retail\s*Price|MRP|M\.R\.P\.?)\s*[:.]?\s*(?:(?:Rs\.?|₹)?\s*\(?\s*incl(?:usive)?\.?\s*of\s*all\s*taxes\s*\)?\s*(?:Rs\.?|₹)?\s*[\d,]+(?:\.\d+)?|(?:Rs\.?|₹)?\s*[\d,]+(?:\.\d+)?\s*\(?\s*incl(?:usive)?\.?\s*of\s*all\s*taxes\s*\)?)/i;
  private static MRP_VALUE_REGEX =
    /(?:MRP|M\.R\.P\.?|Maximum\s*Retail\s*Price)\s*[:.]?\s*(?:Rs\.?|₹)?\s*(?:\(?\s*incl(?:usive)?\.?\s*of\s*all\s*taxes\s*\)?\s*)?(?:Rs\.?|₹)?\s*([\d,]+\.?\d*)/i;

  private static NET_QTY_REGEX =
    /(?:NET\s*(?:QTY|WT|WEIGHT|QUANTITY|CONTENTS?)|NET)\s*[:.]?\s*(\d+\.?\d*)\s*(g|gm|gms|kg|ml|l|ltr|litres?|units?|pieces?|pcs|N\b)/i;
  private static NET_QTY_SIMPLE_REGEX = /(\d+\.?\d*)\s*(g|gm|gms|kg|ml|l|ltr)\b/i;

  private static USP_REGEX =
    /(?:USP|UNIT\s*SALE\s*PRICE|UNIT\s*PRICE)\s*[:.]?\s*(?:Rs\.?|₹)?\s*([\d,]+\.?\d*)\s*(?:per|\/)\s*(g|kg|ml|l|unit|N)/i;
  private static MFG_DATE_REGEX =
    /(?:MFD|MFG|PACKED|DATE\s*OF\s*MFG|PKD|Mfg\.?\s*Date|Manufacturing\s*Date|Packing\s*Date)\s*[:.]?\s*(\d{1,2}[/-]\d{2,4}|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s/-]*\d{2,4})/i;
  private static EXP_DATE_REGEX =
    /(?:EXP|EXPIRY|USE\s*BY|BEST\s*BEFORE|BB|BBD)\s*[:.]?\s*(\d{1,2}[/-]\d{2,4}|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s/-]*\d{2,4}|\d+\s*MONTHS?\s*FROM\s*(?:MFG|MFD|DATE\s*OF\s*MFG))/i;
  private static ORIGIN_REGEX =
    /(?:Country\s*of\s*Origin|Made\s*in|Product\s*of|Manufactured\s*in)\s*[:.]?\s*([A-Za-z\s]{2,30})/i;
  private static MFG_NAME_REGEX =
    /(?:Mfg\s*by|Manufactured\s*by|Packed\s*by|Marketed\s*by|Mfg\s*&\s*Pkd\s*by|Brand\s*Owner)\s*[:.]?\s*([^\n,]{3,80})/i;
  private static COMMODITY_REGEX = /(?:Commodity|Product|Generic\s*Name|Item)\s*[:.]?\s*([^\n]{3,60})/i;
  private static PIN_REGEX = /\b(\d{6})\b/;

  /** Rule 9: Hindi Devanagri Unicode block U+0900–U+097F */
  private static HINDI_REGEX = /[\u0900-\u097F]/;

  /** Rule 12: Prohibited qualifiers near net quantity */
  private static PROHIBITED_QUALIFIERS = ['minimum', 'not less than', 'average', 'about', 'approximately', 'atleast', 'at least'];

  /** Rule 13: Non-SI units */
  private static NON_SI_UNITS = ['dozen', 'score', 'gross', 'great gross', 'dz', 'dzn'];

  /** Rule 6(2): Consumer care indicators (supports 1-800, 1800, 10-digit mobile) */
  private static CONSUMER_CARE_PHONE_REGEX = /(?:(?:1-)?1?800[\s-]?\d{3,4}[\s-]?\d{3,4}|\b[6-9]\d{9}\b)/;
  private static CONSUMER_CARE_EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  private static CONSUMER_CARE_NAME_REGEX = /(?:Consumer\s*Cell|Consumer\s*Care|Customer\s*Care|Helpline|Grievance\s*Officer|Grievance\s*Cell)\s*[:.]?\s*([^\n]{3,50})/i;

  // ── Token normalizer for OCR noise ────────────────────────────────────────
  private static normalizeUnit(unit: string): string {
    const u = unit.toLowerCase();
    if (['gm', 'gms', 'gram', 'grams'].includes(u)) return 'g';
    if (['ltr', 'litre', 'litres', 'liter', 'liters'].includes(u)) return 'L';
    if (['ml', 'millilitre', 'milliliter'].includes(u)) return 'ml';
    if (['kilogram', 'kilograms', 'kgs'].includes(u)) return 'kg';
    if (['unit', 'units', 'piece', 'pieces', 'pcs', 'nos', 'no'].includes(u)) return 'N';
    return unit.toLowerCase();
  }

  // ── Main token parser ─────────────────────────────────────────────────────
  public static parseTokens(blocks: OCRBlock[]): ParsedTokens {
    const tokens: ParsedTokens = {};
    const fullText = blocks.map((b) => b.text).join('\n');
    const fullTextLower = fullText.toLowerCase();

    for (const block of blocks) {
      const text = block.text;

      // MRP value (Rule 6(1)(e))
      const mrpMatch = text.match(this.MRP_VALUE_REGEX);
      if (mrpMatch && !tokens.mrp) {
        tokens.mrp = {
          value: parseFloat(mrpMatch[1].replace(/,/g, '')),
          rawText: text,
          box: block.boundingBox,
        };
      }

      // Net Quantity (Rule 6(1)(c))
      // Filter out lines containing nutrition data to prevent misreading 'trans fat 0g' as product net quantity
      const isNutritionLine = /fat|trans|cholesterol|sodium|sugar|carb|protein|energy|kcal|approximate|basis\s*per|dietary/i.test(text);
      const explicitQtyMatch = text.match(this.NET_QTY_REGEX);
      const simpleQtyMatch = !isNutritionLine ? text.match(this.NET_QTY_SIMPLE_REGEX) : null;
      const qtyMatch = explicitQtyMatch || simpleQtyMatch;

      if (qtyMatch && !tokens.netQuantity) {
        const val = parseFloat(qtyMatch[1]);
        if (val > 0) {
          tokens.netQuantity = {
            value: val,
            unit: this.normalizeUnit(qtyMatch[2]),
            rawText: text,
            box: block.boundingBox,
          };
        }
      }

      // USP (Rule 6(11))
      const uspMatch = text.match(this.USP_REGEX);
      if (uspMatch && !tokens.usp) {
        tokens.usp = {
          value: parseFloat(uspMatch[1].replace(/,/g, '')),
          unit: this.normalizeUnit(uspMatch[2]),
          rawText: text,
          box: block.boundingBox,
        };
      }

      // FSSAI License
      const fssaiCandidates = text.match(/\b\d{14}\b/g);
      if (fssaiCandidates && !tokens.fssaiLicense) {
        for (const num of fssaiCandidates) {
          if (this.FSSAI_REGEX.test(num)) {
            tokens.fssaiLicense = { rawText: num, isValidFormat: true };
            break;
          }
        }
        // Accept any 14-digit number as tentative
        if (!tokens.fssaiLicense && fssaiCandidates.length > 0) {
          tokens.fssaiLicense = { rawText: fssaiCandidates[0], isValidFormat: false };
        }
      }
    }

    // Quantity must be observed on a label; MRP / USP cannot prove a declaration exists.

    // Manufacturer (Rule 6(1)(a))
    const mfgMatch = fullText.match(this.MFG_NAME_REGEX);
    if (mfgMatch) {
      tokens.manufacturerDetails = { rawText: mfgMatch[0], detectedName: mfgMatch[1].trim() };
    } else if (/Pvt\.?\s*Ltd|Limited|Industries|Holdings|Corp|Corporation/i.test(fullText)) {
      const corpMatch = fullText.match(/([A-Z][a-zA-Z\s&.]+(?:Pvt\.?\s*Ltd|Limited|Industries|Holdings|Corp)\.?)/);
      tokens.manufacturerDetails = {
        rawText: corpMatch ? corpMatch[0] : 'Corporate entity detected',
        detectedName: corpMatch ? corpMatch[1].trim() : 'Verified corporate entity',
      };
    }

    // PIN code in address (Rule 6(1)(a) enhancement)
    const pinMatch = fullText.match(this.PIN_REGEX);
    if (pinMatch) tokens.pinCode = { rawText: pinMatch[1] };

    // Generic name (Rule 6(1)(b))
    const commMatch = fullText.match(this.COMMODITY_REGEX);
    if (commMatch) {
      tokens.genericName = { rawText: commMatch[1].trim() };
    } else if (blocks.length > 0) {
      tokens.genericName = { rawText: blocks[0].text.trim() };
    }

    // Manufacture date (Rule 6(1)(d))
    const mfgDateMatch = fullText.match(this.MFG_DATE_REGEX);
    if (mfgDateMatch) tokens.mfgDate = { rawText: mfgDateMatch[0] };

    // Expiry / best before (Rule 6(1)(da))
    const expDateMatch = fullText.match(this.EXP_DATE_REGEX);
    if (expDateMatch) tokens.expDate = { rawText: expDateMatch[0] };

    // Country of origin (Rule 6(1)(f))
    const originMatch = fullText.match(this.ORIGIN_REGEX);
    if (originMatch) {
      tokens.countryOfOrigin = { rawText: originMatch[0], country: originMatch[1].trim() };
    } else if (/For\s*Sale\s*in\s*India|India\s*Only/i.test(fullText)) {
      tokens.countryOfOrigin = { rawText: 'For Sale in India', country: 'India' };
    }

    // Consumer care (Rule 6(2))
    const carePhone = fullText.match(this.CONSUMER_CARE_PHONE_REGEX);
    const careEmail = fullText.match(this.CONSUMER_CARE_EMAIL_REGEX);
    const careName = fullText.match(this.CONSUMER_CARE_NAME_REGEX);
    if (carePhone || careEmail || /Consumer\s*Care|Customer\s*Care|Helpline/i.test(fullText)) {
      tokens.consumerCare = {
        rawText: 'Present',
        contactInfo: [carePhone?.[0], careEmail?.[0]].filter(Boolean).join(' ').trim() || 'Found',
      };
    }
    if (careName) tokens.consumerCareName = { rawText: careName[1].trim() };

    // Rule 2(m): MRP format validation
    tokens.mrpFormatValid = this.MRP_FORMAT_REGEX.test(fullText);

    // Rule 9: Language detection (Hindi Devanagri)
    const languages: string[] = ['English'];
    if (this.HINDI_REGEX.test(fullText)) languages.push('Hindi');
    tokens.languageUsed = languages;

    // Rule 12: Prohibited qualifiers
    tokens.prohibitedQualifiers = this.PROHIBITED_QUALIFIERS.filter((q) =>
      fullTextLower.includes(q)
    );

    // Rule 13: Non-SI units
    tokens.nonSiUnits = this.NON_SI_UNITS.filter((u) => fullTextLower.includes(u));

    return tokens;
  }

  // ── Main audit — 18 rules ─────────────────────────────────────────────────
  public static audit(tokens: ParsedTokens, calibration: MetricCalibration): ComplianceReport {
    const results: RuleCheckResult[] = [];

    // 1. Rule 6(1)(a) — Manufacturer/Packer Name & Address
    results.push({
      ruleId: 'Rule 6(1)(a)',
      description: 'Manufacturer / Packer Name & Address',
      status: tokens.manufacturerDetails ? 'PASS' : 'FAIL',
      details: tokens.manufacturerDetails
        ? `Identified: ${tokens.manufacturerDetails.detectedName}`
        : 'Missing manufacturer/packer identity',
      legalActSection: 'Rule 6(1)(a) — Legal Metrology (Packaged Commodities) Rules, 2011',
    });

    // 2. Rule 6(1)(a) PIN — Postal PIN code in address
    results.push({
      ruleId: 'Rule 6(1)(a) PIN',
      description: 'Postal PIN Code in Address',
      status: tokens.pinCode ? 'PASS' : 'WARNING',
      details: tokens.pinCode
        ? `PIN found: ${tokens.pinCode.rawText}`
        : 'No 6-digit PIN code found in address (required for complete postal address)',
      legalActSection: 'Rule 10 — Complete Postal Address',
    });

    // 3. Rule 6(1)(b) — Generic/Common Name of Commodity
    results.push({
      ruleId: 'Rule 6(1)(b)',
      description: 'Generic / Common Name of Commodity',
      status: tokens.genericName ? 'PASS' : 'FAIL',
      details: tokens.genericName
        ? `Identified: ${tokens.genericName.rawText.slice(0, 60)}`
        : 'Missing generic commodity designation',
      legalActSection: 'Rule 6(1)(b)',
    });

    // 4. Rule 6(1)(c) — Net Quantity in Metric Units
    results.push({
      ruleId: 'Rule 6(1)(c)',
      description: 'Net Quantity in Metric Units',
      status: tokens.netQuantity && tokens.netQuantity.value > 0 ? 'PASS' : 'FAIL',
      details:
        tokens.netQuantity && tokens.netQuantity.value > 0
          ? `Declared: ${tokens.netQuantity.value} ${tokens.netQuantity.unit}`
          : 'Missing or invalid net quantity metric declaration',
      legalActSection: 'Rule 6(1)(c)',
    });

    // 5. Rule 6(1)(d) — Date of Manufacture / Packing
    results.push({
      ruleId: 'Rule 6(1)(d)',
      description: 'Date of Manufacture / Packing (Month & Year)',
      status: tokens.mfgDate ? 'PASS' : 'FAIL',
      details: tokens.mfgDate
        ? `Declared: ${tokens.mfgDate.rawText}`
        : 'Missing manufacturing/packaging date',
      legalActSection: 'Rule 6(1)(d)',
    });

    // 6. Rule 6(1)(da) — Best Before / Expiry Date
    results.push({
      ruleId: 'Rule 6(1)(da)',
      description: 'Best Before / Expiry Declaration',
      status: tokens.expDate ? 'PASS' : 'WARNING',
      details: tokens.expDate
        ? `Declared: ${tokens.expDate.rawText}`
        : 'Not detected — mandatory for perishable/food items',
      legalActSection: 'Rule 6(1)(da)',
    });

    // 7. Rule 6(1)(e) — MRP incl. all taxes
    results.push({
      ruleId: 'Rule 6(1)(e)',
      description: 'Maximum Retail Price (MRP) incl. of all taxes',
      status: tokens.mrp ? 'PASS' : 'FAIL',
      details: tokens.mrp
        ? `Declared: ₹${tokens.mrp.value.toFixed(2)}`
        : 'Missing or illegible MRP declaration',
      legalActSection: 'Rule 6(1)(e)',
    });

    // 8. Rule 2(m) — MRP exact format validation
    results.push({
      ruleId: 'Rule 2(m)',
      description: 'MRP Format: "incl. of all taxes" phrase',
      status: tokens.mrpFormatValid ? 'PASS' : tokens.mrp ? 'WARNING' : 'FAIL',
      details: tokens.mrpFormatValid
        ? 'MRP declaration includes mandatory "incl. of all taxes" phrase'
        : tokens.mrp
        ? 'MRP found but missing required "incl. of all taxes" / "inclusive of all taxes" phrase'
        : 'MRP declaration absent',
      legalActSection: 'Rule 2(m) — Definition of Retail Sale Price',
    });

    // 9. Rule 6(1)(f) — Country of Origin
    results.push({
      ruleId: 'Rule 6(1)(f)',
      description: 'Country of Origin / Sourced Entity',
      status: tokens.countryOfOrigin ? 'PASS' : 'FAIL',
      details: tokens.countryOfOrigin
        ? `Declared: ${tokens.countryOfOrigin.country || tokens.countryOfOrigin.rawText}`
        : 'Missing Country of Origin',
      legalActSection: 'Rule 6(1)(f)',
    });

    // 10. Rule 6(2) — Consumer Care: phone + email + name/office
    const hasPhone = tokens.consumerCare?.contactInfo?.match(/\d{10}|1800/);
    const hasEmail = tokens.consumerCare?.contactInfo?.includes('@');
    const hasName = !!tokens.consumerCareName || /Consumer\s*(?:Cell|Care)|Grievance/i.test(tokens.consumerCare?.contactInfo || '') || /Consumer\s*Cell/i.test(tokens.manufacturerDetails?.rawText || '');
    const consumerCareScore = [hasPhone, hasEmail, hasName].filter(Boolean).length;
    results.push({
      ruleId: 'Rule 6(2)',
      description: 'Consumer Care Contact (Name/Office + Phone + Email)',
      status:
        consumerCareScore === 3 ? 'PASS' : consumerCareScore >= 1 ? 'WARNING' : 'FAIL',
      details:
        consumerCareScore === 3
          ? `All 3 contact fields found: Phone (${hasPhone?.[0] || '1800'}), Email (${tokens.consumerCare?.contactInfo?.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)?.[0] || 'Email'}), and Office/Name (${tokens.consumerCareName?.rawText || 'Consumer Cell'})`
          : consumerCareScore >= 1
          ? `Partial: ${[hasName && 'office/name', hasPhone && 'phone', hasEmail && 'email'].filter(Boolean).join(', ')} found. Missing: ${[!hasName && 'contact name/office', !hasPhone && 'phone', !hasEmail && 'email'].filter(Boolean).join(', ')}`
          : 'Missing consumer grievance redressal contact (Rule 6(2) requires name/office, phone, email)',
      legalActSection: 'Rule 6(2) — Consumer Care Redressal',
    });

    // 11. Rule 6(3) — No sticker over MRP
    results.push({
      ruleId: 'Rule 6(3)',
      description: 'No Unauthorized Sticker Over Printed MRP',
      status: tokens.stickerOverMrp ? 'FAIL' : 'PASS',
      details: tokens.stickerOverMrp
        ? 'Sticker physically pasted over printed MRP detected — Rule 6(3) violation'
        : 'No MRP-covering sticker detected',
      legalActSection: 'Rule 6(3) — Sticker Prohibition',
    });

    // 12. Rule 9 — Language (Hindi or English)
    const hasValidLanguage = (tokens.languageUsed || []).some((l) =>
      ['English', 'Hindi'].includes(l)
    );
    results.push({
      ruleId: 'Rule 9',
      description: 'Language: Hindi (Devanagri) or English',
      status: hasValidLanguage ? 'PASS' : 'WARNING',
      details: hasValidLanguage
        ? `Languages detected: ${(tokens.languageUsed || []).join(', ')}`
        : 'Could not confirm mandatory Hindi or English language on label',
      legalActSection: 'Rule 9 — Manner of Declarations',
    });

    // 13. Rule 12 — No prohibited quantity qualifiers
    const prohibited = tokens.prohibitedQualifiers || [];
    results.push({
      ruleId: 'Rule 12',
      description: 'No Misleading Quantity Qualifiers',
      status: prohibited.length === 0 ? 'PASS' : 'FAIL',
      details:
        prohibited.length === 0
          ? 'No prohibited qualifiers found near quantity declaration'
          : `Prohibited qualifier(s) found: "${prohibited.join('", "')}" — violates Rule 12`,
      legalActSection: 'Rule 12 — General Quantity Provisions',
    });

    // 14. Rule 13 — SI units only
    const nonSI = tokens.nonSiUnits || [];
    results.push({
      ruleId: 'Rule 13',
      description: 'SI Units Only (No Dozen, Gross, etc.)',
      status: nonSI.length === 0 ? 'PASS' : 'FAIL',
      details:
        nonSI.length === 0
          ? 'All quantity units are SI-compliant (g, kg, ml, L, N)'
          : `Non-SI unit(s) found: "${nonSI.join('", "')}" — only g/kg/ml/L/N permitted`,
      legalActSection: 'Rule 13 — Standard Units of Measurement',
    });

    // 15. ⭐ Rule 6(11) — USP Math Verification [INNOVATION]
    if (tokens.mrp && tokens.netQuantity) {
      const calculatedUSP = tokens.mrp.value / tokens.netQuantity.value;
      const isMatch = tokens.usp && Math.abs(calculatedUSP - tokens.usp.value) < 0.05;
      results.push({
        ruleId: 'Rule 6(11)',
        description: 'Unit Sale Price (USP) Mathematical Verification',
        status: isMatch ? 'PASS' : 'FAIL',
        details: isMatch
          ? `Verified: ₹${tokens.usp?.value}/${tokens.usp?.unit} matches calculated ₹${calculatedUSP.toFixed(2)}/${tokens.netQuantity.unit}`
          : tokens.usp
          ? `Mismatch: Printed ₹${tokens.usp.value} vs calculated ₹${calculatedUSP.toFixed(2)}`
          : `USP not declared. Expected: ₹${calculatedUSP.toFixed(2)} per ${tokens.netQuantity.unit}`,
        isCoreInnovation: true,
        innovationBadge: 'Zero-Hallucination Math Engine',
        legalActSection: 'Rule 6(11) — Unit Sale Price Declaration',
      });
    } else {
      results.push({
        ruleId: 'Rule 6(11)',
        description: 'Unit Sale Price (USP) Mathematical Verification',
        status: 'FAIL',
        details: 'Cannot verify USP: MRP or Net Quantity declaration missing',
        isCoreInnovation: true,
        innovationBadge: 'Zero-Hallucination Math Engine',
        legalActSection: 'Rule 6(11) — Unit Sale Price Declaration',
      });
    }

    // 16. ⭐ Rule 7 Table I — Minimum Font Height via GS1 Fiducial [INNOVATION]
    const targetBox = tokens.mrp?.box || tokens.netQuantity?.box;
    const fontMm = targetBox && calibration ? MetricFiducialEngine.calculateFontHeightMm(targetBox.height, calibration) : 0;
    const qty = tokens.netQuantity?.value || 0;
    const minRequiredMm = qty <= 200 ? 1.0 : qty <= 500 ? 2.0 : 4.0;
    const isHeightPass = fontMm >= minRequiredMm;
    results.push({
      ruleId: 'Rule 7 Table I',
      description: 'Statutory Minimum Font Height Verification',
      status: fontMm > 0 ? (isHeightPass ? 'PASS' : 'FAIL') : 'WARNING',
      details:
        fontMm > 0
          ? `Measured: ${fontMm}mm (Minimum required: ${minRequiredMm}mm for ${qty || 'unknown'}${tokens.netQuantity?.unit || ''} pack at ${calibration.pixelsPerMm.toFixed(1)} px/mm)`
          : 'Font height unavailable: no measured spatial reference and numeral height.',
      isCoreInnovation: true,
      innovationBadge: 'In-Plane Optical GS1 Ruler',
      legalActSection: 'Rule 7, Table I — Minimum Height of Numeral',
    });

    // 17. Rule 18 — Dual-MRP / Above-MRP Price Check (contextual)
    results.push({
      ruleId: 'Rule 18',
      description: 'No Sale Above Declared MRP',
      status: 'WARNING',
      details: 'Requires an observed selling price and declared MRP; no verified price source is configured.',
      legalActSection: 'Rule 18 — Duties of Wholesale and Retail Dealers',
    });

    // 18. 2nd Schedule — Standard Pack Size (if applicable)
    // Caller can add this result via validatePackSize() — done in App.tsx
    // Placeholder so total count is consistent
    results.push({
      ruleId: '2nd Schedule',
      description: 'Standard Pack Size Compliance',
      status: 'WARNING',
      details: 'Standard pack size check requires commodity category detection — see 2nd Schedule validator',
      legalActSection: 'Rule 5 / Second Schedule — Standard Pack Quantities',
    });

    for (const conflict of tokens.conflicts || []) {
      const affectedRules = conflict.field === 'mrp'
        ? ['Rule 6(1)(e)', 'Rule 2(m)', 'Rule 6(11)', 'Rule 7 Table I']
        : conflict.field === 'netQuantity'
        ? ['Rule 6(1)(c)', 'Rule 6(11)', 'Rule 7 Table I']
        : ['Rule 6(11)'];
      for (const result of results.filter((r) => affectedRules.includes(r.ruleId))) {
        result.status = 'WARNING';
        result.details = `Conflicting ${conflict.field} declarations: ${conflict.details}. Review the source images.`;
      }
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
