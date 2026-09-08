import { test, expect, type Page } from '@playwright/test';
import type { HistoryBook } from '../../src/lib/history-types';

async function importBook(page: Page, title: string, status = 'read', sourceId = title) {
  const { token } = await (await page.request.get('/api/auth/csrf')).json();
  const preview = await page.request.post('/api/imports/preview', {
    headers: { 'x-csrf-token': token },
    multipart: { file: { name: 'history.csv', mimeType: 'text/csv', buffer: Buffer.from(`Book Id,Title,Author,ISBN13,My Rating,Exclusive Shelf,Date Read\n${sourceId},${title},History Fixture Writer,9780306406157,4,${status},2024-01-02\n`) } },
  });
  expect(preview.ok()).toBe(true);
  const { id } = await preview.json();
  expect((await page.request.post(`/api/imports/${id}/commit`, { headers: { 'x-csrf-token': token } })).ok()).toBe(true);
  const { items } = await (await page.request.get(`/api/history?q=${encodeURIComponent(title)}`)).json();
  return items.find((book: HistoryBook) => book.title === title) as HistoryBook;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Password').fill('browser-test-password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByText('PRIVATE · LIVE DATA')).toBeVisible();
  await page.route('https://covers.openlibrary.org/**', route => route.fulfill({ path: 'public/icons/icon-192.png', contentType: 'image/png' }));
});
async function openHistory(page: Page, mobile: boolean) {
  await page.getByRole('navigation', { name: mobile ? 'Mobile navigation' : 'Primary', exact: true }).getByRole('button', { name: 'History', exact: true }).click();
}

test('edits status in the list and cover details, persists after reload/reimport, and keeps the search', async ({ page }, info) => {
  const title = `History status ${info.project.name}`;
  const book = await importBook(page, title);
  await openHistory(page, info.project.name === 'mobile');
  await page.getByLabel('Search books').fill(title);
  const status = page.getByLabel(`Reading status for ${title}`, { exact: true });
  await status.selectOption('to-read');
  await expect(page.getByRole('status').filter({ hasText: `Status saved for ${title}.` })).toBeVisible();
  await expect(status).toHaveValue('to-read');
  await expect(page.getByLabel('Search books')).toHaveValue(title);
  const trigger = page.getByRole('button', { name: `View details for ${title}`, exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('img', { name: `Cover of ${title}` })).toBeVisible();
  await expect.poll(() => dialog.getByRole('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(dialog.getByText('2024-01-02')).toBeVisible();
  await dialog.getByLabel(`Reading status for ${title}`, { exact: true }).selectOption('currently-reading');
  await expect(dialog.getByRole('status')).toHaveText(`Status saved for ${title}.`);
  await dialog.getByLabel(`Rate ${title}`, { exact: true }).selectOption('5');
  await expect(dialog.getByRole('status')).toHaveText(`Rating saved for ${title}.`);
  await page.screenshot({ path: info.outputPath('history-details.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  const reimported = await importBook(page, title, 'dnf');
  expect(reimported).toMatchObject({ exclusive_status: 'currently-reading', imported_status: 'dnf', personal_rating: 5 });
  await page.reload();
  await openHistory(page, info.project.name === 'mobile');
  await page.getByLabel('Search books').fill(title);
  await expect(status).toHaveValue('currently-reading');
  await status.selectOption('');
  await expect(page.getByRole('status').filter({ hasText: `Status saved for ${title}.` })).toBeVisible();
  const saved = await (await page.request.get(`/api/history?q=${encodeURIComponent(title)}`)).json();
  expect(saved.items.find((row: HistoryBook) => row.id === book.id)).toMatchObject({ exclusive_status: 'dnf', status_override: null });
  const exported = await (await page.request.get('/api/export')).json();
  expect(exported.readingStatuses).toBeDefined();
});

test('keeps the previous status on failure and allows a retry without leaving history', async ({ page }, info) => {
  const title = `History failure ${info.project.name}`; await importBook(page, title);
  await openHistory(page, info.project.name === 'mobile');
  await page.getByLabel('Search books').fill(title);
  await page.route('**/api/history', route => route.request().method() === 'PATCH'
    ? route.fulfill({ status: 503, json: { error: 'Status could not be saved. Please retry.' } }) : route.continue());
  const status = page.getByLabel(`Reading status for ${title}`, { exact: true });
  await status.selectOption('on-hold');
  await expect(page.locator('.data-page').getByRole('alert')).toHaveText('Status could not be saved. Please retry.');
  await expect(status).toHaveValue('');
  await expect(status).toBeEnabled();
  await page.unroute('**/api/history');
  await status.selectOption('on-hold');
  await expect(status).toHaveValue('on-hold');
  await expect(page.locator('.data-page').getByRole('alert')).toHaveCount(0);
});

test('falls back from a missing ISBN cover, handles unavailable lookup, and retries in place', async ({ page }, info) => {
  const title = `History cover ${info.project.name}`; const book = await importBook(page, title);
  await page.route('https://covers.openlibrary.org/b/isbn/**', route => route.fulfill({ status: 404, body: '' }));
  await page.route(`**/api/history/${book.id}/cover`, route => route.fulfill({ status: 502, json: { error: 'Unavailable' } }));
  await openHistory(page, info.project.name === 'mobile');
  await page.getByRole('button', { name: `View details for ${title}`, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Cover unavailable', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Retry cover' })).toBeVisible();
  await page.route(`**/api/history/${book.id}/cover`, route => route.fulfill({ json: { coverUrl: 'https://covers.openlibrary.org/b/id/123-L.jpg?default=false' } }));
  await dialog.getByRole('button', { name: 'Retry cover' }).click();
  await expect.poll(() => dialog.getByRole('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(dialog.getByRole('button', { name: 'Retry cover' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close book details' }).click();
});

test('protects status changes with owner authentication, CSRF, enum validation and record checks', async ({ page, playwright }) => {
  const outsider = await playwright.request.newContext({ baseURL: 'http://localhost:3102' });
  expect((await outsider.patch('/api/history', { data: {} })).status()).toBe(401);
  expect((await outsider.get('/api/history/1/cover')).status()).toBe(401);
  await outsider.dispose();
  expect((await page.request.patch('/api/history', { data: {} })).status()).toBe(403);
  const { token } = await (await page.request.get('/api/auth/csrf')).json();
  const headers = { 'x-csrf-token': token };
  expect((await page.request.patch('/api/history', { headers, data: { workKey: 'missing-work-key-long-enough', status: 'anything' } })).status()).toBe(400);
  expect((await page.request.patch('/api/history', { headers, data: { workKey: 'missing-work-key-long-enough', status: 'read' } })).status()).toBe(404);
  expect((await page.request.get('/api/history/nope/cover')).status()).toBe(400);
  expect((await page.request.get('/api/history/999999/cover')).status()).toBe(404);
});
