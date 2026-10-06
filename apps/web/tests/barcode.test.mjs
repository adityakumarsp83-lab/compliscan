import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { retailBarcode } from './helpers/retailBarcode.mjs';
const directory = await mkdtemp(join(tmpdir(), 'compliscan-barcodes-'));
after(() => rm(directory, { recursive: true, force: true }));
for (const name of ['barcodeTypes', 'barcodeWorker']) {
  const source = await readFile(new URL(`../src/${name}.ts`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  await writeFile(join(directory, `${name}.mjs`), output.replace("'./barcodeTypes'", "'./barcodeTypes.mjs'").replace("'@zxing/library'", JSON.stringify(import.meta.resolve('@zxing/library'))));
}
const { decodeBarcodePixels } = await import(pathToFileURL(join(directory, 'barcodeWorker.mjs')).href);

test('real EAN-13 and EAN-8 bar pixels decode with measured outer bar-pattern widths', () => {
  for (const [value, expected] of [['4006381333931', '4006381333931'], ['96385074', '96385074'], ['0036000291452', '036000291452']]) {
    const fixture = retailBarcode(value);
    const barcode = decodeBarcodePixels(fixture.rgba, fixture.width, fixture.height);
    assert.equal(barcode?.value, expected);
    assert.ok(Math.abs(barcode.widthPx - fixture.barWidth) < 1, `${barcode.widthPx} vs ${fixture.barWidth}`);
  }
});
test('vertical retail barcode reads and preserves its pixel scale', () => {
  const original = retailBarcode('4006381333931');
  const width = original.height, height = original.width;
  const rgba = new Uint8ClampedArray(original.rgba.length);
  for (let y = 0; y < original.height; y++) for (let x = 0; x < original.width; x++) {
    const input = (y * original.width + x) * 4; const output = (x * width + width - 1 - y) * 4;
    rgba.set(original.rgba.subarray(input, input + 4), output);
  }
  const barcode = decodeBarcodePixels(rgba, width, height);
  assert.equal(barcode?.value, '4006381333931'); assert.ok(Math.abs(barcode.widthPx - original.barWidth) < 1);
  assert.ok(Math.abs(barcode.points[1].x - barcode.points[0].x) < 2);
});
test('blank images and invalid check digits never manufacture a GTIN or scale', () => {
  assert.equal(decodeBarcodePixels(new Uint8ClampedArray(100 * 100 * 4).fill(255), 100, 100), undefined);
  const invalid = retailBarcode('4006381333932');
  assert.equal(decodeBarcodePixels(invalid.rgba, invalid.width, invalid.height), undefined);
});
