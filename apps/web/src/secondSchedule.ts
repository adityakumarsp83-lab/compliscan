/**
 * Second Schedule validator — Legal Metrology (Packaged Commodities) Rules, 2011
 * Checks if a commodity's declared pack size matches the prescribed standard quantities.
 */

interface ScheduleEntry {
  allowedValues: number[]; // in grams or ml
  unit: 'g' | 'ml' | 'kg' | 'L';
  stepAfter?: { above: number; step: number }; // "multiples of X above Y"
  note?: string;
}

/** Convert any quantity to a base unit for comparison */
function normalizeToBase(value: number, unit: string): { baseValue: number; baseUnit: 'g' | 'ml' } | null {
  const u = unit.toLowerCase();
  if (u === 'g' || u === 'gm') return { baseValue: value, baseUnit: 'g' };
  if (u === 'kg') return { baseValue: value * 1000, baseUnit: 'g' };
  if (u === 'ml') return { baseValue: value, baseUnit: 'ml' };
  if (u === 'l' || u === 'ltr' || u === 'litre') return { baseValue: value * 1000, baseUnit: 'ml' };
  return null;
}

function isAllowed(baseValue: number, entry: ScheduleEntry): boolean {
  const normalizedAllowed = entry.allowedValues.map((v) => {
    if (entry.unit === 'kg') return v * 1000;
    if (entry.unit === 'L') return v * 1000;
    return v;
  });

  if (normalizedAllowed.includes(baseValue)) return true;

  if (entry.stepAfter) {
    const { above, step } = entry.stepAfter;
    const normalizedAbove = entry.unit === 'kg' ? above * 1000 : entry.unit === 'L' ? above * 1000 : above;
    const normalizedStep = entry.unit === 'kg' ? step * 1000 : entry.unit === 'L' ? step * 1000 : step;
    if (baseValue > normalizedAbove && (baseValue - normalizedAbove) % normalizedStep === 0) return true;
  }

  return false;
}

// ── Full Second Schedule from legal.md ──────────────────────────────────────
const SECOND_SCHEDULE: Record<string, ScheduleEntry & { keywords: string[] }> = {
  baby_food: {
    keywords: ['baby food', 'weaning food', 'infant food', 'cerelac', 'baby cereal'],
    allowedValues: [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 2000, 5000, 10000],
    unit: 'g',
  },
  biscuits: {
    keywords: ['biscuit', 'cookie', 'crackers', 'marie', 'parle-g', 'bourbon', 'digestive'],
    allowedValues: [25, 50, 75, 100, 150, 200, 250, 300],
    unit: 'g',
    stepAfter: { above: 300, step: 100 }, // multiples of 100g up to 1kg
  },
  bread: {
    keywords: ['bread', 'loaf'],
    allowedValues: [100],
    unit: 'g',
    stepAfter: { above: 100, step: 100 },
    note: 'Excluding buns',
  },
  butter_margarine: {
    keywords: ['butter', 'margarine'],
    allowedValues: [25, 50, 100, 200, 500, 1000, 2000, 5000],
    unit: 'g',
    stepAfter: { above: 5000, step: 5000 },
    note: 'Uncanned only',
  },
  cereals_pulses: {
    keywords: ['rice', 'wheat', 'dal', 'lentil', 'pulse', 'grain', 'chana', 'moong', 'toor', 'masoor', 'rajma', 'cereal'],
    allowedValues: [100, 200, 500, 1000, 2000, 5000],
    unit: 'g',
    stepAfter: { above: 5000, step: 5000 },
  },
  coffee: {
    keywords: ['coffee', 'bru', 'nescafe', 'davidoff'],
    allowedValues: [25, 50, 100, 200, 250, 500, 1000],
    unit: 'g',
    stepAfter: { above: 1000, step: 1000 },
  },
  tea: {
    keywords: ['tea', 'chai', 'tata tea', 'lipton', 'red label', 'wagh bakri'],
    allowedValues: [25, 50, 100, 125, 250, 500, 1000],
    unit: 'g',
    stepAfter: { above: 1000, step: 1000 },
  },
  edible_oil: {
    keywords: ['edible oil', 'cooking oil', 'vanaspati', 'ghee', 'sunflower oil', 'groundnut oil', 'mustard oil', 'soybean oil', 'palm oil', 'refined oil'],
    allowedValues: [50, 100, 200, 500, 1000, 2000, 3000, 5000],
    unit: 'g',
    stepAfter: { above: 5000, step: 5000 },
  },
  milk_powder: {
    keywords: ['milk powder', 'skimmed milk', 'full cream milk powder'],
    allowedValues: [50, 100, 200, 500, 1000],
    unit: 'g',
    stepAfter: { above: 1000, step: 500 },
  },
  detergent: {
    keywords: ['detergent', 'washing powder', 'surf', 'ariel', 'tide', 'nirma', 'wheel'],
    allowedValues: [50, 100, 200, 500, 700, 1000, 1500, 2000],
    unit: 'g',
    stepAfter: { above: 2000, step: 1000 },
  },
  flour: {
    keywords: ['atta', 'rawa', 'maida', 'suji', 'semolina', 'wheat flour'],
    allowedValues: [100, 200, 500, 1000, 2000, 5000],
    unit: 'g',
    stepAfter: { above: 5000, step: 5000 },
  },
  salt: {
    keywords: ['salt', 'namak', 'tata salt', 'annapurna salt'],
    allowedValues: [50, 100, 200, 500, 750, 1000, 2000, 5000],
    unit: 'g',
    stepAfter: { above: 5000, step: 5000 },
  },
  toilet_soap: {
    keywords: ['soap', 'bath soap', 'lux', 'dove', 'lifebuoy', 'dettol soap', 'pears'],
    allowedValues: [25, 50, 75, 100, 125, 150],
    unit: 'g',
    stepAfter: { above: 150, step: 50 },
  },
  aerated_drinks: {
    keywords: ['cola', 'soda', 'soft drink', 'pepsi', 'coca-cola', 'sprite', 'thums up', 'limca', 'maaza', 'frooti', 'minute maid'],
    allowedValues: [100, 150, 200, 250, 300, 330, 500, 750, 1000, 1500, 2000, 3000, 4000, 5000],
    unit: 'ml',
  },
  water: {
    keywords: ['mineral water', 'drinking water', 'packaged water', 'bisleri', 'kinley', 'aquafina', 'himalayan water'],
    allowedValues: [100, 150, 200, 250, 300, 500, 750, 1000, 1500, 2000, 3000, 4000, 5000],
    unit: 'ml',
  },
  cement: {
    keywords: ['cement', 'ordinary portland cement', 'opc', 'ppc'],
    allowedValues: [1000, 2000, 5000, 10000, 20000, 25000, 40000, 50000],
    unit: 'g',
  },
  paint_varnish: {
    keywords: ['paint', 'varnish', 'enamel', 'primer', 'asian paints', 'berger', 'nerolac'],
    allowedValues: [50, 100, 200, 500, 1000, 2000, 3000, 4000, 5000],
    unit: 'ml',
    stepAfter: { above: 5000, step: 5000 },
  },
};

export type PackSizeStatus = 'PASS' | 'FAIL' | 'SKIP';

export interface PackSizeResult {
  status: PackSizeStatus;
  message: string;
  matchedCategory?: string;
}

/**
 * Checks if a commodity's declared pack size matches the Second Schedule.
 * Returns SKIP if the commodity doesn't match any Second Schedule category.
 */
export function validatePackSize(
  genericName: string,
  quantityValue: number,
  quantityUnit: string
): PackSizeResult {
  const name = genericName.toLowerCase();
  const normalized = normalizeToBase(quantityValue, quantityUnit);

  if (!normalized) {
    return { status: 'SKIP', message: 'Unit not recognized for Second Schedule check' };
  }

  // Cosmetics, hair oils, toilet preparations are not restricted under 2nd Schedule
  if (name.includes('hair oil') || name.includes('shampoo') || name.includes('cosmetic')) {
    return {
      status: 'PASS',
      message: `${quantityValue} ${quantityUnit} is compliant — Hair oil / cosmetics are exempt from 2nd Schedule standard pack size restrictions`,
    };
  }

  for (const [categoryKey, entry] of Object.entries(SECOND_SCHEDULE)) {
    const matched = entry.keywords.some((kw) => name.includes(kw));
    if (!matched) continue;

    const allowed = isAllowed(normalized.baseValue, entry);
    const displayUnit = normalized.baseUnit === 'g' ? (normalized.baseValue >= 1000 ? 'kg' : 'g') : normalized.baseValue >= 1000 ? 'L' : 'ml';
    const displayValue = normalized.baseUnit === 'g'
      ? normalized.baseValue >= 1000 ? normalized.baseValue / 1000 : normalized.baseValue
      : normalized.baseValue >= 1000 ? normalized.baseValue / 1000 : normalized.baseValue;

    if (allowed) {
      return {
        status: 'PASS',
        message: `${displayValue}${displayUnit} is a permitted standard pack size under 2nd Schedule (${categoryKey.replace('_', ' ')})`,
        matchedCategory: categoryKey,
      };
    } else {
      return {
        status: 'FAIL',
        message: `${displayValue}${displayUnit} is NOT a permitted standard pack size under 2nd Schedule for ${categoryKey.replace('_', ' ')}. Check prescribed quantities in Rule 5.`,
        matchedCategory: categoryKey,
      };
    }
  }

  return { status: 'SKIP', message: 'Commodity not listed in 2nd Schedule — no standard pack size restriction applies' };
}
