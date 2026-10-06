export interface ProductBenchmark {
  barcode: string;
  brandName: string;
  standardNetQuantity: number;
  standardUnit: string;
  authorizedStandardMRP: number;
  manufacturer: string;
}

export interface AnomalyVerdict {
  isDualMRP: boolean;
  mrpMarkupPercent: number;
  isShrinkflated: boolean;
  grammageReductionPercent: number;
  effectiveStealthHikePercent: number;
  narrative: string;
}

// No authenticated benchmark feed is configured. Never substitute sample prices.
export const NATIONAL_COMMODITY_REGISTRY: Record<string, ProductBenchmark> = {};

export function evaluatePriceAndGrammageAnomalies(
  barcode: string,
  scannedMRP: number,
  scannedQty: number
): AnomalyVerdict | null {
  if (scannedQty <= 0 || scannedMRP <= 0) return null;
  const benchmark = NATIONAL_COMMODITY_REGISTRY[barcode];
  if (!benchmark) return null;

  const mrpMarkup = scannedMRP - benchmark.authorizedStandardMRP;
  const isDualMRP = mrpMarkup > 0.5;
  const mrpMarkupPercent = isDualMRP ? (mrpMarkup / benchmark.authorizedStandardMRP) * 100 : 0;

  const qtyDeficit = benchmark.standardNetQuantity - scannedQty;
  const isShrinkflated = qtyDeficit > 1.0;
  const grammageReductionPercent = isShrinkflated
    ? (qtyDeficit / benchmark.standardNetQuantity) * 100
    : 0;

  const baseUnitCost = benchmark.authorizedStandardMRP / benchmark.standardNetQuantity;
  const currentUnitCost = scannedMRP / scannedQty;
  const effectiveStealthHikePercent = ((currentUnitCost - baseUnitCost) / baseUnitCost) * 100;

  let narrative = '';
  if (isDualMRP && isShrinkflated) {
    narrative = `Critical Multi-Infraction: Dual-MRP price markup of ₹${mrpMarkup.toFixed(2)} (${mrpMarkupPercent.toFixed(1)}%) combined with ${grammageReductionPercent.toFixed(1)}% stealth grammage reduction under Rule 18.`;
  } else if (isDualMRP) {
    narrative = `Rule 18 Dual-MRP Violation: Scanned price (₹${scannedMRP.toFixed(2)}) exceeds standard authorized retail baseline (₹${benchmark.authorizedStandardMRP.toFixed(2)}) by ${mrpMarkupPercent.toFixed(1)}%.`;
  } else if (isShrinkflated) {
    narrative = `Shrinkflation Detected: Package grammage reduced from ${benchmark.standardNetQuantity}g to ${scannedQty}g (-${grammageReductionPercent.toFixed(1)}%), causing an effective stealth price increase of ${effectiveStealthHikePercent.toFixed(1)}% per gram.`;
  } else {
    narrative = 'Price and net grammage conform strictly to national registered benchmarks.';
  }

  return {
    isDualMRP,
    mrpMarkupPercent,
    isShrinkflated,
    grammageReductionPercent,
    effectiveStealthHikePercent,
    narrative,
  };
}
