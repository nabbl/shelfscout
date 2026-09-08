import { expect, test } from '@playwright/test';

const recommendation = { workKey: 'series-request-fixture', editionKey: '/works/OL5W', title: 'The Fifth Book', author: 'Test Writer', language: 'en', category: 'discovery', subjects: [], why: 'Fixture', caveat: '', series: 'Fixture Chronicles', seriesMemberships: [{ key: 'OL123L', name: 'Fixture Chronicles', position: 5 }] };
const members = [
  { key: '/works/OL1W', title: 'The Beginning', position: 1 },
  { key: '/works/OL2W', title: 'The Read Book', position: 2, read: true },
  { key: '/works/OL3W', title: 'The Owned Book', position: 3, owned: true },
  { key: '/works/OL4W', title: 'The Requested Book', position: 4, requested: true },
  { key: '/works/OL5W', title: 'The Fifth Book', position: 5 },
].map(book => ({ ...book, author: 'Test Writer', language: 'en', sourceUrl: `https://openlibrary.org${book.key}` }));
const response = { series: recommendation.seriesMemberships[0], complete: true, stale: false, checkedAt: '2026-09-08T00:00:00Z', message: 'Catalog order shown. Coverage may be incomplete.', books: members };

test.beforeEach(async ({ page }) => {
  await page.route('**/api/recommendations', route => route.fulfill({ json: { last: { items: [recommendation], rankingAdapter: 'Fixture', diagnostics: { catalogPool: 1 } } } }));
  await page.route('**/api/recommendations/series?*', route => route.fulfill({ json: response }));
  await page.route('**/api/integrations/bookorbit', route => route.fulfill({ json: { ok: true, collections: [{ id: 12, name: 'Reading shelf' }, { id: 34, name: 'Travel shelf' }] } }));
  await page.route('**/api/acquisitions', route => route.fulfill({ json: { items: [] } }));
  await page.goto('/'); await page.getByLabel('Password').fill('browser-test-password'); await page.getByRole('button', { name: /sign in/i }).click();
});

test('a recommendation opens its series and requests book one with the correct identity', async ({ page }) => {
  let submitted: Record<string, unknown> | undefined;
  await page.route('**/api/acquisitions', route => {
    if (route.request().method() === 'POST') { submitted = route.request().postDataJSON(); return route.fulfill({ json: { acquisition: { id: 'first' } } }); }
    return route.fulfill({ json: { items: [] } });
  });
  await page.getByRole('button', { name: 'Fixture Chronicles · Book 5', exact: true }).click();
  await page.getByRole('button', { name: 'Get first book', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Get The Beginning', exact: true });
  await dialog.getByRole('button', { name: 'Get book', exact: true }).click();
  await expect.poll(() => submitted).toMatchObject({ title: 'The Beginning', providerId: '/works/OL1W', isbn13: null, language: 'en', targetCollectionId: '12' });
  await expect(page.getByRole('heading', { name: 'From request to Ready for Kobo.' })).toBeVisible();
});

test('selects unread books by default, supports all books and sends one bulk request', async ({ page }, testInfo) => {
  const submissions: Record<string, unknown>[] = [];
  await page.route('**/api/acquisitions', async route => {
    if (route.request().method() === 'POST') {
      expect(route.request().headers()['x-csrf-token']).toBeTruthy();
      submissions.push(route.request().postDataJSON());
      await new Promise(resolve => setTimeout(resolve, 300));
      return route.fulfill({ json: { items: [{ acquisition: { id: 'one' } }, { acquisition: { id: 'five' } }] } });
    }
    return route.fulfill({ json: { items: [] } });
  });
  await page.getByRole('button', { name: 'Fixture Chronicles · Book 5', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Select The Beginning', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Select The Read Book', exact: true })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Select The Owned Book', exact: true })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: 'Select The Requested Book', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Select all available books' }).click();
  await expect(page.getByRole('button', { name: 'Get selected books (3)', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear selection' }).click();
  await expect(page.getByRole('button', { name: 'Get selected books (0)', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Select unread books' }).click();
  await page.screenshot({ path: testInfo.outputPath('series-selection.png'), fullPage: false });
  await page.getByRole('button', { name: 'Get selected books (2)', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Get 2 books', exact: true });
  await expect(dialog.getByText('The Beginning', { exact: false })).toBeVisible();
  await dialog.getByLabel('Kobo collection').selectOption('34');
  await dialog.getByLabel('Requested language', { exact: true }).fill('de');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({ path: testInfo.outputPath('series-bulk-request.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Get 2 books', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Requesting…' })).toBeDisabled();
  await expect(dialog).toHaveCount(0);
  expect(submissions).toHaveLength(1);
  expect(submissions[0]).toMatchObject({ language: 'de', targetCollectionId: '34', books: [{ providerId: '/works/OL1W', title: 'The Beginning', isbn13: null }, { providerId: '/works/OL5W', title: 'The Fifth Book', isbn13: null }] });
});

test('partial or ambiguous lists allow individual selection but do not guess book one', async ({ page }) => {
  await page.route('**/api/recommendations/series?*', route => route.fulfill({ json: { ...response, complete: false, books: [members[0], { ...members[4], position: null }], message: 'Only part of the series could be checked.' } }));
  await page.getByRole('button', { name: 'Fixture Chronicles · Book 5', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Get first book', exact: true })).toHaveCount(0);
  await expect(page.getByText('A unique book one could not be verified. Choose from the listed books below.')).toBeVisible();
  await page.getByRole('button', { name: 'Get The Fifth Book', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Get The Fifth Book', exact: true })).toBeVisible();
});

test('a failed lookup can be retried and cancellation returns to the selected series', async ({ page }) => {
  let attempts = 0;
  await page.route('**/api/recommendations/series?*', route => ++attempts === 1 ? route.fulfill({ status: 502, json: { error: 'Open Library is limiting requests. Please try again shortly.' } }) : route.fulfill({ json: response }));
  await page.getByRole('button', { name: 'Fixture Chronicles · Book 5', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveText('Open Library is limiting requests. Please try again shortly.');
  await page.getByRole('button', { name: 'Retry series lookup', exact: true }).click();
  await page.getByRole('button', { name: 'Get selected books (2)', exact: true }).click();
  await page.getByRole('dialog', { name: 'Get 2 books', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Get selected books (2)', exact: true })).toBeVisible();
  expect(attempts).toBe(2);
});

test('bulk acquisition API enforces CSRF, validates the entire selection and reuses requests', async ({ request }) => {
  const input = { books: [{ title: 'Bulk API First', author: 'Fixture Writer', providerKey: 'openlibrary', providerId: '/works/OL111W' }, { title: 'Bulk API Second', author: 'Fixture Writer', providerKey: 'openlibrary', providerId: '/works/OL112W' }], language: 'en', targetCollectionId: '12' };
  expect((await request.post('/api/acquisitions', { data: input })).status()).toBe(401);
  await request.post('/api/auth/login', { data: { password: 'browser-test-password' } });
  expect((await request.post('/api/acquisitions', { data: input })).status()).toBe(403);
  const { token } = await (await request.get('/api/auth/csrf')).json();
  const headers = { 'x-csrf-token': token };
  expect((await request.post('/api/acquisitions', { headers, data: { ...input, books: [input.books[0], { title: '' }] } })).status()).toBe(400);
  expect((await request.post('/api/acquisitions', { headers, data: { ...input, books: [] } })).status()).toBe(400);
  const first = await request.post('/api/acquisitions', { headers, data: input });
  expect(first.status()).toBe(200);
  const ids = (await first.json()).items.map((item: { acquisition: { id: string } }) => item.acquisition.id);
  expect(new Set(ids).size).toBe(2);
  const repeated = await request.post('/api/acquisitions', { headers, data: input });
  const items = (await repeated.json()).items;
  expect(items.map((item: { acquisition: { id: string } }) => item.acquisition.id)).toEqual(ids);
  expect(items.every((item: { idempotent: boolean }) => item.idempotent)).toBe(true);
});
