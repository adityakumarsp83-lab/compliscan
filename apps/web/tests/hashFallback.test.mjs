import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const directory = await mkdtemp(join(tmpdir(), 'compliscan-http-hash-'));
after(() => rm(directory, { recursive: true, force: true }));
const source = readFileSync(new URL('../src/imageEvidence.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const target = join(directory, 'imageEvidence.mjs');
await writeFile(target, outputText.replace("'@noble/hashes/sha2.js'", JSON.stringify(import.meta.resolve('@noble/hashes/sha2.js'))));
const { sha256, hashImage, createEvidenceManifest } = await import(pathToFileURL(target).href);
const expected = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('HTTP fallback hashes empty, block-boundary, binary, large, and sliced original bytes correctly', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value: { getRandomValues() {} }, configurable: true });
  try {
    for (const length of [0, 3, 55, 56, 63, 64, 65, 1000, 1048576]) {
      const bytes = Uint8Array.from({ length }, (_, index) => index % 256);
      assert.equal(await sha256(bytes), expected(bytes), `length ${length}`);
      assert.equal(await hashImage(new Blob([bytes])), expected(bytes));
    }
    const whole = Uint8Array.from([99, 97, 98, 99, 99]);
    const slice = whole.subarray(1, 4);
    assert.equal(await sha256(slice), expected(slice));
    assert.equal(await sha256(new DataView(whole.buffer, 1, 3)), expected(slice));
    assert.equal(await sha256(slice.slice().buffer), expected(slice));
    assert.notEqual(await hashImage(new Blob(['abc'])), await hashImage(new Blob(['abd'])));
    const images = [
      { imageIndex: 0, fileName: 'front.jpg', surface: 'Front', sha256: await hashImage(new Blob(['front'])) },
      { imageIndex: 1, fileName: 'side.jpg', surface: 'Side', sha256: await hashImage(new Blob(['side'])) },
    ];
    assert.equal((await createEvidenceManifest(images)).checksum, expected(Buffer.from(JSON.stringify(images))));
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
    else delete globalThis.crypto;
  }
});

test('native Web Crypto and HTTP fallback produce identical fingerprints', async () => {
  const bytes = new TextEncoder().encode('Original packaging photograph');
  const native = await sha256(bytes);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
  try { assert.equal(await sha256(bytes), native); }
  finally { if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor); else delete globalThis.crypto; }
});
