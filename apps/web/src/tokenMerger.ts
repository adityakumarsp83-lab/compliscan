import type { ParsedTokens, OCRBlock } from './engine';
import type { GeminiExtractionResult } from './apiClient';

export type OCRSource = 'tesseract' | 'gemini' | 'manual';

export interface TaggedScan {
  tokens: ParsedTokens;
  blocks: OCRBlock[];
  source: OCRSource;
  imageIndex: number;
  surface?: string;
  confidence?: number; // 0–100 when supplied by the engine; absent for manual/Gemini
}

/** Harmonize declarations without discarding complementary fields or conflicting evidence. */
export function mergeTokenSets(scans: TaggedScan[]): ParsedTokens {
  const merged: ParsedTokens = { fieldEvidence: {} };
  // Preserve Gemini preference, but choose the highest confidence within each source.
  const sorted = [...scans].sort((a, b) =>
    a.source === b.source ? (b.confidence ?? -1) - (a.confidence ?? -1) : a.source === 'gemini' ? -1 : 1
  );
  const fields = ['manufacturerDetails', 'genericName', 'netQuantity', 'mfgDate', 'expDate',
    'mrp', 'countryOfOrigin', 'usp', 'fssaiLicense', 'pinCode', 'consumerCareName'] as const;

  for (const scan of sorted) {
    for (const field of [...fields, 'consumerCare'] as const) {
      const value = scan.tokens[field];
      if (!value) continue;
      (merged.fieldEvidence![field] ||= []).push({
        imageIndex: scan.imageIndex,
        surface: scan.surface || `Image ${scan.imageIndex + 1}`,
        source: scan.source,
        confidence: scan.confidence,
        rawText: value.rawText,
      });
      if (field !== 'consumerCare' && merged[field] === undefined) {
        Object.assign(merged, { [field]: value });
      }
    }
  }

  // A phone on the crimp and email on the side belong to the same declaration record.
  const care = sorted.flatMap((scan) => scan.tokens.consumerCare ? [scan.tokens.consumerCare] : []);
  if (care.length) {
    merged.consumerCare = {
      rawText: [...new Set(care.map((value) => value.rawText))].join('\n'),
      contactInfo: [...new Set(care.map((value) => value.contactInfo))].join(' '),
    };
  }
  for (const field of ['prohibitedQualifiers', 'nonSiUnits', 'languageUsed'] as const) {
    const values = sorted.flatMap((scan) => scan.tokens[field] || []);
    if (sorted.some((scan) => scan.tokens[field] !== undefined)) merged[field] = [...new Set(values)];
  }
  if (sorted.some((scan) => scan.tokens.stickerOverMrp !== undefined)) {
    merged.stickerOverMrp = sorted.some((scan) => scan.tokens.stickerOverMrp === true);
  }
  // Only accept tax wording associated with the selected MRP, not an unrelated surface's price.
  if (merged.mrp) {
    merged.mrpFormatValid = sorted.some((scan) =>
      scan.tokens.mrp?.value === merged.mrp!.value && scan.tokens.mrpFormatValid === true
    );
  }

  const conflicts: NonNullable<ParsedTokens['conflicts']> = [];
  for (const field of ['mrp', 'netQuantity', 'usp'] as const) {
    // Arbitration between engines on one image happens above. Compare distinct surfaces.
    const candidates = new Map<number, { value: string; label: string }>();
    for (const scan of sorted) {
      const token = scan.tokens[field];
      if (!token || candidates.has(scan.imageIndex)) continue;
      let value = token.value;
      let unit = 'unit' in token ? token.unit.toLowerCase() : 'INR';
      const factor = unit === 'kg' || unit === 'l' ? 1000 : 1;
      if (unit === 'kg') unit = 'g';
      if (unit === 'l') unit = 'ml';
      if (field === 'netQuantity') value *= factor;
      if (field === 'usp') value /= factor;
      candidates.set(scan.imageIndex, {
        value: `${Number(value.toFixed(8))}:${unit}`,
        label: `${scan.surface || `Image ${scan.imageIndex + 1}`}: ${token.rawText}`,
      });
    }
    if (new Set([...candidates.values()].map((candidate) => candidate.value)).size > 1) {
      conflicts.push({ field, details: [...candidates.values()].map((candidate) => candidate.label).join(' | ') });
    }
  }
  if (conflicts.length) merged.conflicts = conflicts;
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
