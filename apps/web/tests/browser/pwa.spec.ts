import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const user = { userId: 'pwa-test', name: 'Test Inspector', role: 'INSPECTOR', inspectorId: 'TEST-001' };

test('mobile PWA caches real OCR, retains originals across launches, and exports offline', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/auth/login', (route) => route.fulfill({ json: { token: 'test-token', user } }));
  await page.goto('/');
  await expect(page.getByText('Offline scanner ready', { exact: false })).toBeVisible();
  const manifest = await page.evaluate(async () => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')!;
    return (await fetch(link.href)).json();
  });
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.some((icon: { purpose?: string }) => icon.purpose === 'maskable')).toBe(true);
  await page.getByPlaceholder('e.g. jdoe_inspector').fill('test');
  await page.locator('input[type="password"]').fill('password');
  await page.getByRole('button', { name: 'Sign In', exact: true }).last().click();
  await expect(page.locator('#tab-scanner')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile-scanner.png', fullPage: true });
  const fixture = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 500;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1000, 500);
    ctx.fillStyle = 'black'; ctx.font = '40px Arial';
    ['Product: Snack', 'Net Wt: 100 g', 'MRP Rs. 10 incl. of all taxes', 'MFD: 09/2026', 'Customer Care: 9876543210'].forEach((text, index) => ctx.fillText(text, 40, 80 + index * 80));
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const bytes = Buffer.from(fixture, 'base64');
  const hash = createHash('sha256').update(bytes).digest('hex');
  await context.setOffline(true);
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.locator('#camera-capture').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: bytes });
  await expect(page.getByText(hash, { exact: true })).toBeVisible();
  await expect(page.locator('img[alt="Image 1"]').locator('..')).not.toContainText('0%');
  const textarea = page.locator('textarea');
  await expect(textarea).toHaveValue(/Snack/i);
  expect(requests.some((url) => /cdn\.jsdelivr|tessdata\.projectnaptha/.test(url))).toBe(false);
  expect(requests.some((url) => /\/api\/ocr\//.test(url))).toBe(false);
  await page.selectOption('#capture-surface', 'Side');
  await page.locator('#camera-capture').setInputFiles({ name: 'side.png', mimeType: 'image/png', buffer: bytes });
  await expect(page.locator('img[alt^="Image "]')).toHaveCount(2);
  await expect(page.locator('#camera-capture')).toBeEnabled();
  await expect(page.getByText(hash, { exact: true })).toHaveCount(0); // Combined manifest differs from individual hash.
  // Wait for the complete two-photo record, including the index write.
  await expect.poll(async () => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('keyval-store'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
    const values = await new Promise<unknown[]>((resolve) => { const req = db.transaction('keyval').objectStore('keyval').getAll(); req.onsuccess = () => resolve(req.result); });
    db.close();
    return values.filter((item: any) => item?.photos?.length === 2).length;
  })).toBe(1);
  await page.close();
  const reopened = await context.newPage();
  reopened.on('pageerror', (error) => errors.push(error.message));
  await reopened.goto('/');
  await expect(reopened.locator('#tab-history')).toBeVisible(); // Profile survives a new app launch without a persistent JWT.
  await expect(reopened.getByText('Offline scanner ready', { exact: false })).toBeVisible();
  await reopened.locator('#tab-history').click();
  await reopened.getByRole('button', { name: /Open audit .*Snack/i }).click();
  await expect(reopened.locator('img[alt^="Image "]')).toHaveCount(2);
  await expect(reopened.locator('textarea')).toHaveValue(/Snack/i);
  const downloadPromise = reopened.waitForEvent('download');
  await reopened.getByRole('button', { name: /PDF/i }).click();
  const download = await downloadPromise;
  const pdf = await readFile((await download.path())!);
  expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  expect(pdf.toString('latin1')).toContain(hash);
  // Reject a photo whose bytes no longer match the saved SHA-256.
  await reopened.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => { const req = indexedDB.open('keyval-store'); req.onsuccess = () => resolve(req.result); });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('keyval', 'readwrite'); const store = transaction.objectStore('keyval');
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        if (String(cursor.key).startsWith('evidence:')) {
          const value = cursor.value; value.photos[0].blob = new Blob(['changed'], { type: 'image/png' }); cursor.update(value);
        } else cursor.continue();
      };
      transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error);
    }); db.close();
  });
  await reopened.locator('#tab-history').click();
  await reopened.getByRole('button', { name: /Open audit .*Snack/i }).click();
  await expect(reopened.getByText('Saved image does not match its evidence hash.')).toBeVisible();
  await reopened.getByTitle('Delete Record').click();
  await expect(reopened.getByRole('button', { name: /Open audit .*Snack/i })).toHaveCount(0);
  expect(await reopened.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => { const req = indexedDB.open('keyval-store'); req.onsuccess = () => resolve(req.result); });
    const keys = await new Promise<IDBValidKey[]>((resolve) => { const req = db.transaction('keyval').objectStore('keyval').getAllKeys(); req.onsuccess = () => resolve(req.result); }); db.close();
    return keys.filter((key) => String(key).startsWith('evidence:')).length;
  })).toBe(0);
  const queuedOriginals = await reopened.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => { const req = indexedDB.open('keyval-store'); req.onsuccess = () => resolve(req.result); });
    const pending = await new Promise<any[]>((resolve) => { const req = db.transaction('keyval').objectStore('keyval').getAll(); req.onsuccess = () => resolve(req.result.filter((value: any) => value?.eventId)); }); db.close();
    return Promise.all(pending.flatMap((item: any) => item.evidence?.photos || []).map(async (photo: any) => Array.from(new Uint8Array(await photo.blob.arrayBuffer()))));
  });
  expect(queuedOriginals.length).toBeGreaterThanOrEqual(2);
  expect(queuedOriginals.some(bytes => createHash('sha256').update(Buffer.from(bytes)).digest('hex') === hash)).toBe(true);
  expect(errors).toEqual([]);
});
