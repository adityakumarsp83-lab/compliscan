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

export const NATIONAL_COMMODITY_REGISTRY: Record<string, ProductBenchmark> = {
  '8901491101895': {
    barcode: '8901491101895',
    brandName: 'Kurkure Masala Munch',
    standardNetQuantity: 150,
    standardUnit: 'g',
    authorizedStandardMRP: 30.0,
    manufacturer: 'PepsiCo India Holdings Pvt Ltd',
  },
  '8901719104052': {
    barcode: '8901719104052',
    brandName: 'Parle-G Gold Biscuits',
    standardNetQuantity: 100,
    standardUnit: 'g',
    authorizedStandardMRP: 10.0,
    manufacturer: 'Parle Products Pvt Ltd',
  },
  '8901030383452': {
    barcode: '8901030383452',
    brandName: 'Bru Instant Coffee',
    standardNetQuantity: 50,
    standardUnit: 'g',
    authorizedStandardMRP: 95.0,
    manufacturer: 'Hindustan Unilever Limited',
  },
  '8901058852312': {
    barcode: '8901058852312',
    brandName: 'Maggi 2-Minute Noodles',
    standardNetQuantity: 70,
    standardUnit: 'g',
    authorizedStandardMRP: 14.0,
    manufacturer: 'Nestle India Limited',
  },
  '8901207045677': {
    barcode: '8901207045677',
    brandName: 'Dabur Almond Hair Oil',
    standardNetQuantity: 45,
    standardUnit: 'ml',
    authorizedStandardMRP: 33.0,
    manufacturer: 'Dabur India Ltd.',
  },
  '8901063093638': {
    barcode: '8901063093638',
    brandName: 'Britannia Good Day Butter Biscuit',
    standardNetQuantity: 58.6,
    standardUnit: 'g',
    authorizedStandardMRP: 10.0,
    manufacturer: 'Britannia Industries Ltd.',
  },
};

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
