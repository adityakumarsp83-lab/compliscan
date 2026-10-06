import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DOTENV_CONFIG_PATH='/dev/null';
process.env.COMPLISCAN_TEST = '1';
process.env.NODE_ENV = 'production';
process.env.JWT_SECRET = 'test-only-auth-verification-secret';
process.env.FRONTEND_ORIGINS = 'https://compliscan-test.vercel.app';
delete process.env.DATABASE_URL;
const { isAllowedOrigin } = await import('../dist/origins.js');
const { generateToken } = await import('../dist/authMiddleware.js');
const { default: app } = await import('../dist/server.js');
let server, base;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));

test('production CORS accepts only explicit frontend origins', () => {
  assert.equal(isAllowedOrigin('https://compliscan-test.vercel.app'), true);
  assert.equal(isAllowedOrigin('https://evil.vercel.app'), false);
  assert.equal(isAllowedOrigin('https://compliscan-test.vercel.app.evil.com'), false);
  assert.equal(isAllowedOrigin('http://localhost:5173'), false);
  assert.equal(isAllowedOrigin(undefined), true);
});

test('health boots without a database or a local Python process', async () => {
  const res = await fetch(`${base}/health`, { headers: { Origin: 'https://compliscan-test.vercel.app' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://compliscan-test.vercel.app');
  const health = await res.json();
  assert.equal(health.paddle_running, false);
  assert.equal(health.db_connected, false);
});

test('auth verification accepts a signed token and rejects forged signatures', async () => {
  const user = { userId: 'test', name: 'Test Inspector', role: 'INSPECTOR', inspectorId: 'TEST-001' };
  const token = generateToken(user);
  const post = (value) => fetch(`${base}/api/auth/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: value }) });
  const valid = await post(token); assert.equal(valid.status, 200); assert.equal((await valid.json()).user.userId, user.userId);
  const forged = `${token.split('.').slice(0, 2).join('.')}.forged`;
  assert.equal((await post(forged)).status, 401);
  assert.equal((await post({ invalid: true })).status, 400);
});
