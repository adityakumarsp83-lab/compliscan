import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
const directory = await mkdtemp(join(tmpdir(), 'compliscan-concurrent-'));
after(() => rm(directory, { recursive: true, force: true }));
const source = readFileSync(new URL('../src/concurrentProcessing.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const target = join(directory, 'concurrentProcessing.mjs'); await writeFile(target, outputText);
const { mapConcurrent } = await import(pathToFileURL(target).href);

test('two jobs start before either completes, queued jobs drain, and results preserve input order', async () => {
  const started = []; const releases = new Map(); let active = 0; let maximum = 0;
  const run = mapConcurrent([0, 1, 2, 3, 4], 2, async (item) => {
    started.push(item); active++; maximum = Math.max(maximum, active);
    await new Promise((resolve) => releases.set(item, resolve)); active--; return `image-${item}`;
  });
  assert.deepEqual(started, [0, 1]);
  releases.get(1)(); await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [0, 1, 2]);
  releases.get(2)(); await new Promise((resolve) => setImmediate(resolve));
  releases.get(3)(); await new Promise((resolve) => setImmediate(resolve));
  releases.get(4)(); releases.get(0)();
  assert.deepEqual((await run).map((result) => result.value), ['image-0', 'image-1', 'image-2', 'image-3', 'image-4']);
  assert.equal(maximum, 2);
});

test('one failed image does not cancel later images and empty batches need no workers', async () => {
  const seen = [];
  const results = await mapConcurrent([0, 1, 2, 3], 2, async (item) => {
    seen.push(item); if (item === 1) throw new Error('Unreadable image'); return item;
  });
  assert.deepEqual(seen.sort(), [0, 1, 2, 3]);
  assert.equal(results[1].status, 'rejected'); assert.equal(results[3].value, 3);
  assert.deepEqual(await mapConcurrent([], 2, async () => { throw new Error('Unexpected job'); }), []);
});
