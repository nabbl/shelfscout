import { expect, test } from '@playwright/test';

const book = { workKey: 'card-feedback-fixture', editionKey: '/works/OL1W', title: 'The Cover Book', author: 'Test Writer', language: 'en', coverUrl: '/icons/icon-192.png', category: 'discovery', subjects: [], why: 'A grounded explanation.', caveat: '' };

test.beforeEach(async ({ page }) => {
  await page.route('**/api/recommendations', route => route.fulfill({ json: { last: { items: [book], rankingAdapter: 'Fixture', diagnostics: { catalogPool: 1 } } } }));
  await page.goto('/'); await page.getByLabel('Password').fill('browser-test-password'); await page.getByRole('button', { name: /sign in/i }).click();
});

test('clicking the cover opens details and the placeholder also works from the keyboard', async ({ page }) => {
  await page.getByRole('button', { name: `View details for ${book.title}`, exact: true }).getByRole('img').click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: book.title, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Why it fits' })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.route('**/api/recommendations', route => route.fulfill({ json: { last: { items: [{ ...book, coverUrl: null }], rankingAdapter: 'Fixture', diagnostics: { catalogPool: 1 } } } }));
  await page.reload();
  const cover = page.getByRole('button', { name: `View details for ${book.title}`, exact: true });
  await expect(cover.getByText('Cover unavailable')).toBeVisible();
  await cover.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog').getByRole('heading', { name: book.title, exact: true })).toBeVisible();
});

test('X opens feedback choices without dismissing, and Cancel or Escape leaves the card', async ({ page }, testInfo) => {
  let posts = 0;
  await page.route('**/api/feedback', route => { posts++; return route.fulfill({ json: { ok: true } }); });
  const trigger = page.getByRole('button', { name: `Feedback for ${book.title}`, exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'What about this book?' });
  for (const name of [/^Already read/, /^Not now/, /^Not interested/]) await expect(dialog.getByRole('button', { name })).toBeVisible();
  expect(posts).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({ path: testInfo.outputPath('feedback-choices.png'), fullPage: false });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(trigger).toBeFocused();
  await trigger.click(); await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: book.title, exact: true })).toBeVisible();
  expect(posts).toBe(0);
});

for (const [label, action] of [['Already read', 'already_read'], ['Not now', 'not_now'], ['Not interested', 'not_interested']] as const) {
  test(`X → ${label} sends the selected action once and removes the card`, async ({ page }) => {
    const posts: Record<string, unknown>[] = [];
    await page.route('**/api/feedback', async route => {
      posts.push(route.request().postDataJSON()); expect(route.request().headers()['x-csrf-token']).toBeTruthy();
      await new Promise(resolve => setTimeout(resolve, 300)); return route.fulfill({ json: { ok: true } });
    });
    await page.getByRole('button', { name: `Feedback for ${book.title}`, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'What about this book?' });
    if (action !== 'already_read') {
      await dialog.getByText('Add a reason (optional)', { exact: true }).click();
      await dialog.getByRole('textbox').fill('Not in the mood for this today.');
    }
    await dialog.getByRole('button', { name: new RegExp(`^${label}`) }).click();
    await expect(dialog.getByRole('button', { name: /^Already read/ })).toBeDisabled();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('heading', { name: book.title, exact: true })).toHaveCount(0);
    expect(posts).toEqual([{ workKey: book.workKey, action, ...(action === 'already_read' ? {} : { reason: 'Not in the mood for this today.' }) }]);
  });
}

test('feedback failures preserve the book and choices and allow retry', async ({ page }) => {
  let attempts = 0;
  await page.route('**/api/feedback', route => ++attempts === 1 ? route.fulfill({ status: 503, json: { error: 'Try again.' } }) : route.fulfill({ json: { ok: true } }));
  await page.getByRole('button', { name: `Feedback for ${book.title}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'What about this book?' });
  await dialog.getByRole('button', { name: /^Already read/ }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Feedback could not be saved. Please retry.');
  await expect(dialog.getByRole('button', { name: /^Already read/ })).toBeEnabled();
  await dialog.getByRole('button', { name: /^Already read/ }).click();
  await expect(dialog).toHaveCount(0);
  expect(attempts).toBe(2);
});
