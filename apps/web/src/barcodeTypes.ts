export interface DecodedBarcode {
  value: string;
  format: 'EAN_13' | 'EAN_8' | 'UPC_A';
  /** Estimated outer bar-pattern width, excluding quiet zones, in original photo pixels. */
  widthPx: number;
  points: { x: number; y: number }[];
}

export interface BarcodeScan {
  status: 'detected' | 'not-found' | 'unavailable';
  barcode?: DecodedBarcode;
}

export function validGtin(value: string): boolean {
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(value) || /^0+$/.test(value)) return false;
  const sum = value.slice(0, -1).split('').reverse().reduce((total, digit, i) => total + Number(digit) * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - sum % 10) % 10 === Number(value.at(-1));
}

/** Guard centers are inset 1.5 modules at each end; recover the full bar-pattern span. */
export function barPatternWidth(format: DecodedBarcode['format'], points: { x: number; y: number }[]): number {
  if (points.length < 2) return 0;
  const modules = format === 'EAN_8' ? 67 : 95;
  const span = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
  return Number.isFinite(span) ? Math.round(span * modules / (modules - 3) * 100) / 100 : 0;
}
