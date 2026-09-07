import { expect, test } from '@playwright/test';

const book = { workKey: 'get-fixture', editionKey: '/works/OL1W', title: 'Request Fixture', author: 'Test Writer', language: 'en', year: 2020, category: 'discovery', subjects: [], why: 'Fixture', caveat: '' };

test.beforeEach(async ({ page }) => {
  await page.route('**/api/recommendations', route => route.fulfill({ json: { last: { items: [book], rankingAdapter: 'Fixture', diagnostics: { catalogPool: 1 } } } }));
  await page.route('**/api/integrations/bookorbit', route => route.fulfill({ json: { ok: true, collections: [{ id: 12, name: 'Reading shelf' }, { id: 34, name: 'Travel shelf' }] } }));
});

test('Get book loads collections without a Settings test, submits once and opens Activity', async ({ page }, testInfo) => {
  let submissions = 0;
  await page.route('**/api/acquisitions', async route => {
    if (route.request().method() === 'POST') {
      submissions++;
      expect(route.request().postDataJSON()).toMatchObject({ title: book.title, language: 'en', targetCollectionId: '34' });
      expect(route.request().headers()['x-csrf-token']).toBeTruthy();
      await new Promise(resolve => setTimeout(resolve, 400));
      return route.fulfill({ json: { acquisition: { id: 'fixture' } } });
    }
    return route.fulfill({ json: { items: [{ id: 'fixture', title: book.title, author: book.author, language: 'en', status: 'checking_ownership', releases: [], events: [] }] } });
  });
  await page.goto('/');
  await page.getByLabel('Password').fill('browser-test-password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.getByRole('button', { name: 'Get book', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Get ${book.title}` });
  await dialog.getByLabel('Kobo collection').selectOption('34');
  await page.screenshot({ path: testInfo.outputPath('get-book.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Get book', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Requesting…' })).toBeDisabled();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'From request to Ready for Kobo.' })).toBeVisible();
  await expect(page.getByText('checking ownership', { exact: true })).toBeVisible();
  expect(submissions).toBe(1);
});

test('detail Get book allows a missing language and keeps errors visible through polling', async ({ page }) => {
  await page.route('**/api/recommendations', route => route.fulfill({ json: { last: { items: [{ ...book, language: 'und' }], rankingAdapter: 'Fixture', diagnostics: { catalogPool: 1 } } } }));
  let connected = false;
  await page.route('**/api/integrations/bookorbit', route => !connected ? route.fulfill({ status: 502, json: { error: 'BookOrbit login failed.' } }) : route.fulfill({ json: { ok: true, collections: [{ id: 12, name: 'Reading shelf' }] } }));
  await page.route('**/api/acquisitions', route => {
    expect(route.request().postDataJSON().language).toBe('de');
    return route.fulfill({ status: 400, json: { error: 'Please check this edition.' } });
  });
  await page.goto('/');
  await page.getByLabel('Password').fill('browser-test-password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.getByRole('button', { name: 'Why this book?' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Get book', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Get ${book.title}` });
  await expect(dialog.getByRole('alert')).toHaveText('BookOrbit login failed.');
  connected = true;
  await dialog.getByRole('button', { name: 'Retry connection' }).click();
  await expect(dialog.getByLabel('Kobo collection')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Get book', exact: true })).toBeDisabled();
  await dialog.getByLabel('Requested language', { exact: true }).fill('de');
  await dialog.getByRole('button', { name: 'Get book', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Please check this edition.');
  await page.waitForResponse('**/api/recommendations');
  await expect(dialog.getByRole('alert')).toHaveText('Please check this edition.');
  await expect(dialog.getByRole('button', { name: 'Get book', exact: true })).toBeEnabled();
});

test('a lost submission response offers Activity without automatically replaying the request', async ({ page }) => {
  let submissions = 0;
  await page.route('**/api/acquisitions', route => {
    if (route.request().method() === 'POST') { submissions++; return route.abort('failed'); }
    return route.fulfill({ json: { items: [] } });
  });
  await page.goto('/');
  await page.getByLabel('Password').fill('browser-test-password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.getByRole('button', { name: 'Get book', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Get ${book.title}` });
  await dialog.getByRole('button', { name: 'Get book', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Check Activity before retrying.');
  await dialog.getByRole('button', { name: 'Check Activity' }).click();
  await expect(page.getByText('No acquisitions yet.')).toBeVisible();
  expect(submissions).toBe(1);
});
