import { test, expect } from '@playwright/test';

test('Activity release picker, safe recheck and readiness text work on desktop and mobile', async ({ page }, testInfo) => {
  let selected = false;
  let rechecked = false;
  await page.route('**/api/acquisitions', async route => route.fulfill({ json: { items: [{ id: 'fixture', title: 'A Fixture Book', author: 'Test Writer', language: 'en', status: 'needs_attention', last_error: selected ? 'Review delivery before rechecking.' : 'Choose a release.', workflow: 'shelfmark', events: [], releases: selected ? [] : [
    { index: 0, title: 'A Fixture Book', author: 'Test Writer', language: 'en', format: 'epub', source: 'fixture', selectable: true, reason: 'Confirm the edition.' },
    { index: 1, title: 'A Fixture Book', author: 'Test Writer', language: 'de', format: 'epub', source: 'fixture', selectable: false, reason: 'Language does not match.' },
  ] }] } }));
  await page.route('**/api/acquisitions/fixture', async route => {
    const body = route.request().postDataJSON();
    if (body.action === 'select_release') { expect(body.releaseIndex).toBe(0); selected = true; }
    if (body.action === 'recheck') rechecked = true;
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto('/');
  await page.getByLabel('Password').fill('browser-test-password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByText('PRIVATE · LIVE DATA')).toBeVisible();
  await page.getByRole('navigation', { name: testInfo.project.name === 'mobile' ? 'Mobile navigation' : 'Primary', exact: true }).getByRole('button', { name: 'Activity', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A Fixture Book' })).toBeVisible();
  await expect(page.getByText(/Device delivery is not confirmed/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm this release' }).nth(1)).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Confirm this release' }).first()).toBeEnabled();
  const viewport = page.viewportSize()!;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  await page.screenshot({ path: testInfo.outputPath('acquisition-picker.png'), fullPage: true });
  await page.getByRole('button', { name: 'Confirm this release' }).first().click();
  await expect(page.getByRole('button', { name: 'Confirm this release' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Recheck / refresh releases' }).click();
  await expect.poll(() => rechecked).toBe(true);
});

test('acquisition APIs enforce owner authentication and CSRF', async ({ request }) => {
  expect((await request.get('/api/acquisitions')).status()).toBe(401);
  expect((await request.post('/api/acquisitions/fixture', { data: { action: 'recheck' } })).status()).toBe(401);
  await request.post('/api/auth/login', { data: { password: 'browser-test-password' } });
  expect((await request.post('/api/acquisitions', { data: {} })).status()).toBe(403);
  expect((await request.post('/api/acquisitions/fixture', { data: { action: 'recheck' } })).status()).toBe(403);
});
