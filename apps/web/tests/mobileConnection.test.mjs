import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/apiClient.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const resolveBackend = new Function('env', `${outputText.replaceAll('import.meta.env', 'env').replace(/^export /gm, '')}\nreturn BACKEND_URL;`);

test('local mobile requests use the proxy even when an old env file specifies localhost', () => {
  assert.equal(resolveBackend({ DEV: true, VITE_BACKEND_URL: 'http://localhost:4000' }), '/backend');
  assert.equal(resolveBackend({ DEV: true }), '/backend');
});

test('production keeps an explicitly configured backend and supports a local preview proxy', () => {
  assert.equal(resolveBackend({ DEV: false, VITE_BACKEND_URL: 'https://api.example.com' }), 'https://api.example.com');
  assert.equal(resolveBackend({ DEV: false }), '/backend');
});
