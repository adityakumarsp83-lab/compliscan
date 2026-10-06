import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../src/inspectionMetadata.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const { captureLocation, locationText, inspectionStatus, detectGtin, isLegacyDemoInspection } = await import(`data:text/javascript;base64,${Buffer.from(output.outputText).toString('base64')}`);

test('captures a fresh device reading with accuracy and the device timestamp', async () => {
  let calls = 0;
  const geolocation = { getCurrentPosition(success, _error, options) {
    assert.equal(options.maximumAge, 0); assert.equal(options.enableHighAccuracy, true);
    success({ coords: { latitude: 12 + calls++, longitude: 77.2, accuracy: 7.4 }, timestamp: Date.parse('2026-10-06T06:00:00Z') });
  } };
  const first = await captureLocation({ secure: true, geolocation });
  const second = await captureLocation({ secure: true, geolocation });
  assert.equal(first.latitude, 12); assert.equal(second.latitude, 13);
  assert.equal(first.accuracyM, 7.4); assert.equal(first.recordedAt, '2026-10-06T06:00:00.000Z');
  assert.match(locationText(first), /12.000000.*77.200000.*7 m/);
});

test('HTTP, denied permission, absent API, and invalid coordinates never invent a location', async () => {
  const insecure = await captureLocation({ secure: false, geolocation: { getCurrentPosition() { assert.fail('HTTP must not ask for GPS'); } } });
  assert.equal(insecure.status, 'unavailable'); assert.match(locationText(insecure), /HTTPS/);
  const denied = await captureLocation({ secure: true, geolocation: { getCurrentPosition(_success, error) { error({ code: 1 }); } } });
  assert.equal(denied.latitude, undefined); assert.match(denied.reason, /permission denied/);
  assert.equal((await captureLocation({ secure: true })).status, 'unavailable');
  const invalid = await captureLocation({ secure: true, geolocation: { getCurrentPosition(success) { success({ coords: { latitude: 180, longitude: 77, accuracy: 0 }, timestamp: Date.now() }); } } });
  assert.equal(invalid.status, 'unavailable');
});

test('warnings do not count as compliance, and failed checks count as violations', () => {
  const record = (...status) => ({ report_json: JSON.stringify({ results: status.map((status) => ({ status })) }) });
  assert.equal(inspectionStatus(record('PASS', 'WARNING')), 'REVIEW');
  assert.equal(inspectionStatus(record('PASS', 'FAIL')), 'VIOLATION');
  assert.equal(inspectionStatus(record('PASS')), 'COMPLIANT');
  assert.equal(inspectionStatus({ report_json: '{}' }), 'REVIEW');
});

test('GTIN detection requires a complete number with a valid check digit', () => {
  assert.equal(detectGtin('EAN 4006381333931'), '4006381333931');
  assert.equal(detectGtin('EAN 4006381333932'), undefined);
  assert.equal(detectGtin('No barcode printed'), undefined);
});

test('legacy text demonstrations are hidden while original photographs and manual entries are retained', () => {
  const demo = { raw_text: 'Kurkure Masala Munch (Extruded Snack)\nMfg by PepsiCo India Holdings Pvt Ltd, Village Channo, Sangrur, Punjab - 148026\nNet Wt: 150 g\nFSSAI Lic No: 10014011001895', report_json: '{}' };
  assert.equal(isLegacyDemoInspection(demo), true);
  assert.equal(isLegacyDemoInspection({ ...demo, report_json: JSON.stringify({ evidence: { images: [{}] } }) }), false);
  assert.equal(isLegacyDemoInspection({ ...demo, report_json: JSON.stringify({ inspection: { inputMode: 'manual' } }) }), false);
});
