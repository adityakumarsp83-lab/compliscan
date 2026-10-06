import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// Execute the real modules on Node 20+, without adding a test framework or emitting into src.
const directory = await mkdtemp(join(tmpdir(), 'compliscan-tests-'));
after(() => rm(directory, { recursive: true, force: true }));
async function load(name) {
  const source = readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  const target = join(directory, `${name}.mjs`);
  await writeFile(target, output.outputText.replace("'@noble/hashes/sha2.js'", JSON.stringify(import.meta.resolve('@noble/hashes/sha2.js'))));
  return import(pathToFileURL(target).href);
}
const { LegalMetrologyEngine: engine, MetricFiducialEngine } = await load('engine');
const { mergeTokenSets } = await load('tokenMerger');
const { hashImage, createEvidenceManifest, surfaceForImage } = await load('imageEvidence');
const box = { x: 0, y: 0, width: 100, height: 16 };
const parse = (...lines) => engine.parseTokens(lines.map((text) => ({ text, boundingBox: box })));
const scan = (tokens, imageIndex, options = {}) => ({ tokens, imageIndex, surface: ['Front', 'Crimp', 'Side'][imageIndex], source: 'tesseract', confidence: 90, blocks: [], ...options });
const audit = (tokens) => engine.audit(tokens, MetricFiducialEngine.calibrate(320));

test('raw image hashing matches known SHA-256 and changes with original bytes', async () => {
  const original = await hashImage(new Blob(['abc']));
  assert.equal(original, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.notEqual(await hashImage(new Blob(['abd'])), original);
  const image = { imageIndex: 0, fileName: 'front.png', surface: 'Front', sha256: original };
  assert.equal((await createEvidenceManifest([image])).checksum, original);
  const other = { ...image, imageIndex: 1, surface: 'Side', sha256: await hashImage(new Blob(['side'])) };
  assert.notEqual((await createEvidenceManifest([image, other])).checksum, (await createEvidenceManifest([other, image])).checksum);
  assert.equal(await createEvidenceManifest([]), undefined);
});

test('MRP and USP never manufacture a missing net quantity declaration', () => {
  for (const price of ['USP Rs. 0.20 per g', 'USP Rs. 0.20/g']) {
    const tokens = parse('MRP Rs. 10', price);
    assert.equal(tokens.netQuantity, undefined);
    assert.equal(audit(tokens).results.find((r) => r.ruleId === 'Rule 6(1)(c)').status, 'FAIL');
    assert.equal(audit(tokens).results.find((r) => r.ruleId === 'Rule 6(11)').status, 'FAIL');
  }
});

test('tax phrase is mandatory and supported before or after the price', () => {
  for (const line of ['MRP Rs. 10', 'MRP ₹ 10', 'MRP Rs. 10 excluding taxes']) assert.equal(parse(line).mrpFormatValid, false);
  for (const line of ['MRP Rs. 10 incl. of all taxes', 'MRP ₹ (inclusive of all taxes) 10', 'MRP (INCL. OF ALL TAXES) ₹ 10', 'M.R.P.: Rs. 10.00\n(incl. of all taxes)']) {
    const tokens = parse(line);
    assert.equal(tokens.mrp?.value, 10, line);
    assert.equal(tokens.mrpFormatValid, true, line);
  }
});

test('front, crimp and side combine declarations and complementary contact fields', () => {
  const tokens = mergeTokenSets([
    scan(parse('Product: Snack', 'Net Wt: 100g'), 0),
    scan(parse('MRP Rs. 10 incl. of all taxes', 'Customer Care: Helpdesk 9876543210'), 1),
    scan(parse('Mfg by Example Ltd', 'MFD: 09/2026', 'Email: help@example.com'), 2),
  ]);
  assert.equal(tokens.mrp.value, 10);
  assert.equal(tokens.netQuantity.value, 100);
  assert.ok(tokens.consumerCare.contactInfo.includes('9876543210'));
  assert.ok(tokens.consumerCare.contactInfo.includes('help@example.com'));
  assert.equal(audit(tokens).results.find((r) => r.ruleId === 'Rule 6(2)').status, 'PASS');
  assert.equal(tokens.fieldEvidence.mrp[0].surface, 'Crimp');
  assert.equal(tokens.fieldEvidence.manufacturerDetails[0].imageIndex, 2);
});

test('empty arrays and false flags on front do not suppress side findings', () => {
  const tokens = mergeTokenSets([
    scan({ prohibitedQualifiers: [], nonSiUnits: [], stickerOverMrp: false, languageUsed: ['English'] }, 0),
    scan({ prohibitedQualifiers: ['approximately'], nonSiUnits: ['dozen'], stickerOverMrp: true, languageUsed: ['Hindi'] }, 2),
  ]);
  assert.deepEqual(tokens.prohibitedQualifiers, ['approximately']);
  assert.deepEqual(tokens.nonSiUnits, ['dozen']);
  assert.equal(tokens.stickerOverMrp, true);
  assert.deepEqual(tokens.languageUsed, ['English', 'Hindi']);
});

test('highest confidence wins within Gemini; distinct surface prices remain conflicts', () => {
  const tokens = mergeTokenSets([
    scan(parse('MRP Rs. 10 incl. of all taxes'), 0, { source: 'gemini', confidence: 99 }),
    scan(parse('MRP Rs. 50'), 1, { source: 'gemini', confidence: 50 }),
  ]);
  assert.equal(tokens.mrp.value, 10);
  assert.equal(tokens.conflicts[0].field, 'mrp');
  assert.equal(audit(tokens).results.find((r) => r.ruleId === 'Rule 6(1)(e)').status, 'WARNING');
});

test('equivalent quantity units do not conflict and tax phrases stay tied to a price', () => {
  const tokens = mergeTokenSets([scan(parse('Net Wt 1 kg', 'MRP Rs. 10'), 0), scan(parse('Net Wt 1000 g', 'MRP Rs. 50 incl. of all taxes'), 1)]);
  assert.equal(tokens.conflicts.some((c) => c.field === 'netQuantity'), false);
  assert.equal(tokens.mrpFormatValid, false);
  assert.equal(surfaceForImage('pack-crimp.jpg', 1), 'Crimp');
  assert.equal(surfaceForImage('capture.jpg', 2), 'Image 3');
});
