export interface InspectionLocation {
  status: 'recorded' | 'unavailable';
  latitude?: number;
  longitude?: number;
  accuracyM?: number;
  recordedAt?: string;
  reason?: string;
}

export interface InspectionMetadata {
  id: string;
  capturedAt: string;
  location: InspectionLocation;
  inspectorName?: string;
  inspectorId?: string;
  inputMode: 'photographs' | 'manual';
  sources?: string[];
}

/** Capture the device's current position; never substitute an example or IP location. */
export async function captureLocation(
  environment: { secure: boolean; geolocation?: Pick<Geolocation, 'getCurrentPosition'> } = {
    secure: window.isSecureContext, geolocation: navigator.geolocation,
  }
): Promise<InspectionLocation> {
  if (!environment.secure) return { status: 'unavailable', reason: 'Location requires HTTPS on this device.' };
  if (!environment.geolocation) return { status: 'unavailable', reason: 'Device location is not supported.' };
  return new Promise((resolve) => {
    let settled = false;
    const finish = (location: InspectionLocation) => {
      if (settled) return;
      settled = true; clearTimeout(timer); resolve(location);
    };
    const timer = setTimeout(() => finish({ status: 'unavailable', reason: 'Device location timed out.' }), 11000);
    try {
      environment.geolocation!.getCurrentPosition((position) => {
        const { latitude, longitude, accuracy } = position.coords;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || !Number.isFinite(accuracy) || accuracy < 0 || !Number.isFinite(position.timestamp)) {
          finish({ status: 'unavailable', reason: 'Device returned an invalid location.' }); return;
        }
        finish({ status: 'recorded', latitude, longitude, accuracyM: accuracy,
          recordedAt: new Date(position.timestamp).toISOString() });
      }, (error) => finish({ status: 'unavailable', reason: error.code === 1
        ? 'Location permission denied. Allow location access in browser settings.'
        : error.code === 3 ? 'Device location timed out.' : 'Device could not determine its location.' }),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });
    } catch { finish({ status: 'unavailable', reason: 'Device location could not be read.' }); }
  });
}

export function locationText(location?: InspectionLocation): string {
  if (location?.status !== 'recorded' || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) {
    return `Location unavailable${location?.reason ? `: ${location.reason}` : ' (not recorded)'}`;
  }
  return `${location.latitude!.toFixed(6)}°, ${location.longitude!.toFixed(6)}°${Number.isFinite(location.accuracyM) ? ` (accuracy ±${Math.round(location.accuracyM!)} m)` : ''}`;
}

export function inspectionStatus(record: { report_json: string }): 'COMPLIANT' | 'REVIEW' | 'VIOLATION' {
  try {
    const results = JSON.parse(record.report_json).results as { status: string }[];
    if (!Array.isArray(results) || !results.length) return 'REVIEW';
    if (results.some((result) => result.status === 'FAIL')) return 'VIOLATION';
    return results.every((result) => result.status === 'PASS') ? 'COMPLIANT' : 'REVIEW';
  } catch { return 'REVIEW'; }
}

/** Detect a complete GTIN with a valid check digit, without matching fixture products. */
export function detectGtin(text: string): string | undefined {
  for (const match of text.matchAll(/(?:\b(?:EAN(?:-13)?|GTIN|UPC|BARCODE)\s*[:#-]?\s*|^[ \t]*)(\d{8,14})[ \t]*$/gim)) {
    const digits = match[1];
    if (![8, 12, 13, 14].includes(digits.length) || /^0+$/.test(digits)) continue;
    const sum = digits.slice(0, -1).split('').reverse().reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0);
    if ((10 - sum % 10) % 10 === Number(digits.at(-1))) return digits;
  }
}

/** Recognize the two legacy built-in text demonstrations without deleting saved evidence. */
export function isLegacyDemoInspection(record: { raw_text: string; report_json: string }): boolean {
  try {
    const report = JSON.parse(record.report_json);
    return !report.inspection && !report.evidence?.images?.length &&
      record.raw_text.startsWith('Kurkure Masala Munch (Extruded Snack)\nMfg by PepsiCo India Holdings Pvt Ltd, Village Channo, Sangrur, Punjab - 148026\n') &&
      record.raw_text.endsWith('FSSAI Lic No: 10014011001895');
  } catch { return false; }
}
