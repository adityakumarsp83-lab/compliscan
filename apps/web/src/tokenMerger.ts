import type { ParsedTokens, OCRBlock } from './engine';
import type { GeminiExtractionResult } from './apiClient';

export type OCRSource = 'tesseract' | 'gemini';

export interface TaggedScan {
  tokens: ParsedTokens;
  blocks: OCRBlock[];
  source: OCRSource;
  imageIndex: number;
  confidence: number; // 0–100
}

/**
 * Merge ParsedTokens from multiple image scans (Tesseract + optional Gemini).
 *
 * Priority rules:
 *  1. Non-null value beats null
 *  2. Gemini result beats Tesseract for the same field (when both non-null)
 *  3. Higher confidence beats lower confidence for same-source conflicts
 */
export function mergeTokenSets(scans: TaggedScan[]): ParsedTokens {
  const merged: ParsedTokens = {};

  // Sort so Gemini sources are processed last (they win on conflict)
  const sorted = [...scans].sort((a, b) => {
    if (a.source === b.source) return b.confidence - a.confidence;
    return a.source === 'gemini' ? 1 : -1; // gemini last = highest priority
  });

  for (const scan of sorted) {
    const t = scan.tokens;

    if (t.manufacturerDetails && !merged.manufacturerDetails) merged.manufacturerDetails = t.manufacturerDetails;
    else if (t.manufacturerDetails && scan.source === 'gemini') merged.manufacturerDetails = t.manufacturerDetails;

    if (t.genericName && !merged.genericName) merged.genericName = t.genericName;
    else if (t.genericName && scan.source === 'gemini') merged.genericName = t.genericName;

    if (t.netQuantity && !merged.netQuantity) merged.netQuantity = t.netQuantity;
    else if (t.netQuantity && scan.source === 'gemini') merged.netQuantity = t.netQuantity;

    if (t.mfgDate && !merged.mfgDate) merged.mfgDate = t.mfgDate;
    if (t.expDate && !merged.expDate) merged.expDate = t.expDate;

    if (t.mrp && !merged.mrp) merged.mrp = t.mrp;
    else if (t.mrp && scan.source === 'gemini') merged.mrp = t.mrp;

    if (t.countryOfOrigin && !merged.countryOfOrigin) merged.countryOfOrigin = t.countryOfOrigin;
    if (t.consumerCare && !merged.consumerCare) merged.consumerCare = t.consumerCare;
    else if (t.consumerCare && scan.source === 'gemini') merged.consumerCare = t.consumerCare;

    if (t.usp && !merged.usp) merged.usp = t.usp;
    if (t.fssaiLicense && !merged.fssaiLicense) merged.fssaiLicense = t.fssaiLicense;

    // Extended fields from Gemini
    if (t.pinCode && !merged.pinCode) merged.pinCode = t.pinCode;
    if (t.mrpFormatValid !== undefined && merged.mrpFormatValid === undefined) merged.mrpFormatValid = t.mrpFormatValid;
    if (t.stickerOverMrp !== undefined && merged.stickerOverMrp === undefined) merged.stickerOverMrp = t.stickerOverMrp;
    if (t.prohibitedQualifiers && !merged.prohibitedQualifiers) merged.prohibitedQualifiers = t.prohibitedQualifiers;
    if (t.nonSiUnits && !merged.nonSiUnits) merged.nonSiUnits = t.nonSiUnits;
    if (t.languageUsed && !merged.languageUsed) merged.languageUsed = t.languageUsed;
    if (t.consumerCareName && !merged.consumerCareName) merged.consumerCareName = t.consumerCareName;
  }

  return merged;
}

/**
 * Merge OCRBlock arrays from multiple images, tagging each block with imageIndex.
 */
export function mergeBlocks(scans: TaggedScan[]): (OCRBlock & { imageIndex: number })[] {
  return scans.flatMap((scan) =>
    scan.blocks.map((block) => ({ ...block, imageIndex: scan.imageIndex }))
  );
}

/**
 * Convert Gemini extraction result into ParsedTokens format.
 * This bridges the backend response to the engine's token format.
 */
export function geminiResultToTokens(result: GeminiExtractionResult): ParsedTokens {
  const tokens: ParsedTokens = {};

  if (result.manufacturer_name || result.manufacturer_address) {
    tokens.manufacturerDetails = {
      rawText: `${result.manufacturer_name || ''} ${result.manufacturer_address || ''}`.trim(),
      detectedName: result.manufacturer_name || 'Detected',
    };
  }

  if (result.pin_code) {
    tokens.pinCode = { rawText: result.pin_code };
  }

  if (result.generic_name) {
    tokens.genericName = { rawText: result.generic_name };
  }

  if (result.net_quantity_value !== null && result.net_quantity_unit) {
    tokens.netQuantity = {
      value: result.net_quantity_value,
      unit: result.net_quantity_unit,
      rawText: `${result.net_quantity_value} ${result.net_quantity_unit}`,
      box: { x: 0, y: 0, width: 0, height: 0 }, // no spatial data from Gemini
    };
  }

  if (result.mrp_value !== null) {
    tokens.mrp = {
      value: result.mrp_value,
      rawText: result.mrp_text_exact || `MRP Rs. ${result.mrp_value}`,
      box: { x: 0, y: 0, width: 0, height: 0 },
    };
    tokens.mrpFormatValid = result.mrp_includes_all_taxes;
  }

  if (result.mfg_date) tokens.mfgDate = { rawText: result.mfg_date };
  if (result.exp_date) tokens.expDate = { rawText: result.exp_date };
  if (result.country_of_origin) {
    tokens.countryOfOrigin = { rawText: result.country_of_origin, country: result.country_of_origin };
  }

  if (result.consumer_care_phone || result.consumer_care_email) {
    tokens.consumerCare = {
      rawText: 'Present',
      contactInfo: [result.consumer_care_phone, result.consumer_care_email].filter(Boolean).join(' '),
    };
  }

  if (result.consumer_care_name) {
    tokens.consumerCareName = { rawText: result.consumer_care_name };
  }

  if (result.fssai_license) {
    tokens.fssaiLicense = { rawText: result.fssai_license, isValidFormat: result.fssai_license.length === 14 };
  }

  if (result.usp_value !== null && result.usp_unit) {
    tokens.usp = {
      value: result.usp_value,
      unit: result.usp_unit,
      rawText: `USP Rs. ${result.usp_value} per ${result.usp_unit}`,
      box: { x: 0, y: 0, width: 0, height: 0 },
    };
  }

  tokens.stickerOverMrp = result.sticker_over_mrp_detected;
  tokens.prohibitedQualifiers = result.prohibited_qualifiers_found;
  tokens.nonSiUnits = result.non_si_units_found;
  tokens.languageUsed = result.language_used;

  return tokens;
}
