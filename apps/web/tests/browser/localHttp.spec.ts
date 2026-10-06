import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';

const lanUrl = process.env.PLAYWRIGHT_LAN_URL;
test.use({ baseURL: lanUrl || 'http://127.0.0.1:5173' });

test('a local HTTP camera upload uses real SHA-256 without SubtleCrypto', async ({ page, context }) => {
  test.skip(!lanUrl, 'Set PLAYWRIGHT_LAN_URL to a running non-localhost HTTP Vite server.');
  await context.addInitScript(() => sessionStorage.setItem('compliscan_user', JSON.stringify({ userId: 'local-test', name: 'Test Inspector', role: 'INSPECTOR', inspectorId: 'TEST-001' })));
  // Exercise local OCR only; cloud availability is outside this hashing regression.
  await page.route('**/backend/health', (route) => route.fulfill({ status: 503, json: { status: 'unavailable' } }));
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#camera-capture')).toBeAttached();
  expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
  expect(await page.evaluate(() => typeof crypto.subtle)).toBe('undefined');
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 400;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1000, 400);
    ctx.fillStyle = 'black'; ctx.font = '40px Arial';
    ['Product: Snack', 'Net Wt: 100 g', 'MRP Rs. 10 incl. of all taxes'].forEach((text, index) => ctx.fillText(text, 40, 80 + index * 90));
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const bytes = Buffer.from(encoded, 'base64');
  const expected = createHash('sha256').update(bytes).digest('hex');
  await page.locator('#camera-capture').setInputFiles({ name: 'front.png', mimeType: 'image/png', buffer: bytes });
  await expect(page.getByText(expected, { exact: true })).toBeVisible();
  await expect(page.locator('textarea')).toHaveValue(/Snack/i);
  await expect(page.getByText(/undefined is not an object/)).toHaveCount(0);
  expect(errors).toEqual([]);
});
