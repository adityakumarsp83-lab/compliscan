import { test, expect } from '@playwright/test';
import { retailBarcode } from '../helpers/retailBarcode.mjs';

const lanUrl = process.env.PLAYWRIGHT_LAN_URL;
test.use({ baseURL: lanUrl || 'http://127.0.0.1:4173' });

test('retail barcode and original pixel width decode offline, survive reopen, and flag different products', async ({ page, context }) => {
  const diagnostics: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') diagnostics.push(message.text()); });
  page.on('requestfailed', (request) => diagnostics.push(request.url() + ' ' + request.failure()?.errorText));
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await context.addInitScript(() => {
    sessionStorage.setItem('compliscan_user', JSON.stringify({ userId: 'barcode-test', name: 'Barcode Inspector', role: 'INSPECTOR', inspectorId: 'BAR-001' }));
    Object.defineProperty(window, 'BarcodeDetector', { value: undefined, configurable: true });
  });
  await page.route('**/backend/health', (route) => route.fulfill({ status: 503, json: { status: 'unavailable' } }));
  await page.goto('/');
  if (!lanUrl) await expect(page.getByText('Offline scanner ready', { exact: false })).toBeVisible();
  else await expect(page.locator('#tab-scanner')).toBeVisible();
  const encoded = async (value: string, rotate = false, moduleWidth = 5) => {
    const fixture = retailBarcode(value, moduleWidth);
    const data = await page.evaluate(({ rgba, width, height, rotate }) => {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d')!; ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
      if (!rotate) return canvas.toDataURL('image/png').split(',')[1];
      const turned = document.createElement('canvas'); turned.width = height; turned.height = width;
      const turnedCtx = turned.getContext('2d')!; turnedCtx.translate(height, 0); turnedCtx.rotate(Math.PI / 2); turnedCtx.drawImage(canvas, 0, 0);
      return turned.toDataURL('image/png').split(',')[1];
    }, { rgba: Array.from(fixture.rgba), width: fixture.width, height: fixture.height, rotate });
    return Buffer.from(data, 'base64');
  };
  // Large fixture exercises downscaling and conversion back to original photograph pixels.
  const first = await encoded('4006381333931', false, 20);
  const vertical = await encoded('4006381333931', true, 5);
  const different = await encoded('96385074');
  if (!lanUrl) await context.setOffline(true);
  await page.locator('#btn-hero-start-scan input').setInputFiles({ name: 'front.png', mimeType: 'image/png', buffer: first });
  await expect(page.locator('#product-gtin')).toHaveValue('4006381333931', { timeout: 20000 }).catch((error) => { console.log('Barcode diagnostic:', diagnostics); throw error; });
  await expect.poll(async () => Number(await page.locator('#reference-pixels').inputValue())).toBeGreaterThan(1880);
  expect(Number(await page.locator('#reference-pixels').inputValue())).toBeLessThan(1920);
  await expect(page.locator('#reference-mm')).toHaveValue('');
  await expect(page.locator('#camera-capture')).toBeEnabled();
  await page.locator('#tab-history').click();
  await page.getByRole('button', { name: /Open audit/ }).click();
  await expect(page.locator('#product-gtin')).toHaveValue('4006381333931');
  await expect(page.getByRole('button', { name: /Front.*EAN-13.*4006381333931/ })).toBeVisible();
  await page.locator('#reference-mm').fill('30');
  await page.getByRole('button', { name: 'Re-audit Extracted Tokens' }).click();
  await expect(page.locator('#camera-capture')).toBeEnabled();
  await page.locator('#camera-capture').setInputFiles({ name: 'side.png', mimeType: 'image/png', buffer: vertical });
  await expect(page.getByRole('button', { name: /EAN-13.*4006381333931/ })).toHaveCount(2);
  await expect(page.locator('#product-gtin')).toHaveValue('4006381333931');
  await expect(page.locator('#camera-capture')).toBeEnabled();
  // Selecting a reference on another photograph must clear the previous physical measurement.
  await page.getByRole('button', { name: /EAN-13.*4006381333931/ }).last().click();
  await expect(page.locator('#reference-pixels')).toHaveValue('475');
  await expect(page.locator('#reference-mm')).toHaveValue('');
  await page.locator('#camera-capture').setInputFiles({ name: 'bottom.png', mimeType: 'image/png', buffer: different });
  await expect(page.getByText('Different product barcodes were found.', { exact: false })).toBeVisible();
  await expect(page.locator('#product-gtin')).toHaveValue('');
  await expect(page.locator('#reference-pixels')).toHaveValue('');
  await expect(page.locator('#reference-mm')).toHaveValue('');
  await page.getByRole('button', { name: /EAN-8.*96385074/ }).click();
  await expect(page.locator('#product-gtin')).toHaveValue('96385074');
  await expect(page.locator('#reference-pixels')).toHaveValue('335');
  expect(errors).toEqual([]);
});
