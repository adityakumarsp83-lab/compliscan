import { MetricFiducialEngine } from './src/metricFiducial';
import { LegalMetrologyEngine } from './src/rules';

console.log("=== COMPLISCAN TEST RUN ===");

// 1. Calibrate using a 300px wide detected barcode
const calibration = MetricFiducialEngine.calibrate(300);
console.log(`[Fiducial Scale]: ${calibration.pixelsPerMm.toFixed(2)} px/mm`);

// 2. Simulated OCR text blocks from packaging
const mockBlocks = [
  { text: "Net Wt: 150 g", boundingBox: { x: 10, y: 10, width: 100, height: 16 } },
  { text: "MRP Rs. 30.00", boundingBox: { x: 10, y: 30, width: 150, height: 18 } },
  { text: "USP Rs. 0.20 per g", boundingBox: { x: 10, y: 50, width: 120, height: 10 } },
  { text: "FSSAI Lic No: 10014011001895", boundingBox: { x: 10, y: 70, width: 200, height: 12 } }
];

// 3. Parse and Audit
const tokens = LegalMetrologyEngine.parseTokens(mockBlocks);
const report = LegalMetrologyEngine.audit(tokens, calibration);

console.log(`\nCompliance Score: ${report.score}\n`);
report.results.forEach(r => console.log(`[${r.status}] ${r.ruleId} - ${r.description}: ${r.details}`));
