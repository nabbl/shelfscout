import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByLabel('Password').fill('browser-test-password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByText('PRIVATE · LIVE DATA')).toBeVisible();
  await page.getByRole('navigation', { name: testInfo.project.name === 'mobile' ? 'Mobile navigation' : 'Primary', exact: true }).getByRole('button', { name: 'Settings', exact: true }).click();
});

test('Goodreads uploads after delayed CSRF retrieval and commits into History', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/auth/csrf', async route => {
    await new Promise(resolve => setTimeout(resolve, 150));
    await route.continue();
  });
  const title = `Settings import ${Date.now()}`;
  await page.getByLabel('Goodreads CSV').setInputFiles({ name: 'goodreads.csv', mimeType: 'text/csv', buffer: Buffer.from(`Book Id,Title,Author,My Rating,Exclusive Shelf\n${Date.now()},${title},Fixture Writer,4,read\n`) });
  await page.getByRole('button', { name: 'Preview import', exact: true }).click();
  await expect(page.getByText('Preview ready. Review the rows before confirming.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm import' })).toBeEnabled();
  await page.getByRole('button', { name: 'Confirm import' }).click();
  await expect(page.getByText('Goodreads import complete. Your books are available in History.')).toBeVisible();
  const history = await (await page.request.get('/api/history')).json();
  expect(history.items.some((item: { title: string }) => item.title === title)).toBe(true);
  expect(errors).toEqual([]);
});

test('connection results stay visible in Settings through recommendation polling', async ({ page }) => {
  await page.route('**/api/integrations/bookorbit', route => route.fulfill({ json: { ok: true, collections: [{ id: 7, name: 'Kobo fiction' }] } }));
  await page.route('**/api/integrations/shelfmark', route => route.fulfill({ json: { ok: true } }));
  await page.getByRole('button', { name: 'Test connection', exact: true }).click();
  await expect(page.getByText('BookOrbit connected. 1 Kobo collection(s) available.')).toBeVisible();
  await expect(page.getByLabel('Target Kobo collection')).toHaveValue('7');
  await page.getByRole('button', { name: 'Test Shelfmark connection' }).click();
  await expect(page.getByText('Shelfmark connected. Activity access verified.')).toBeVisible();
  await page.waitForResponse('**/api/recommendations');
  await expect(page.getByText('Shelfmark connected. Activity access verified.')).toBeVisible();
  await expect(page.getByText('BookOrbit connected. 1 Kobo collection(s) available.')).toBeVisible();
});

test('connection buttons show JSON, gateway and network failures and allow retries', async ({ page }) => {
  await page.route('**/api/integrations/bookorbit', route => route.fulfill({ status: 502, json: { ok: false, error: 'BookOrbit HTTP 401. Configure BOOKORBIT_TOKEN.' } }));
  await page.getByRole('button', { name: 'Test connection', exact: true }).click();
  await expect(page.getByText('BookOrbit HTTP 401. Configure BOOKORBIT_TOKEN.')).toBeVisible();
  await page.route('**/api/integrations/shelfmark', route => route.fulfill({ status: 502, contentType: 'text/html', body: '<h1>Bad Gateway</h1>' }));
  await page.getByRole('button', { name: 'Test Shelfmark connection' }).click();
  await expect(page.getByText(/unexpected response \(HTTP 502\)/)).toBeVisible();
  await page.route('**/api/integrations/shelfmark', route => route.abort('failed'));
  await page.getByRole('button', { name: 'Test Shelfmark connection' }).click();
  await expect(page.getByText('Failed to fetch', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Test Shelfmark connection' })).toBeEnabled();
});
