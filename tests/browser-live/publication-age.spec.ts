import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/'); await page.getByLabel('Password').fill('browser-test-password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByText('PRIVATE · LIVE DATA')).toBeVisible();
  const { token } = await (await page.request.get('/api/auth/csrf')).json();
  const { profile } = await (await page.request.get('/api/taste')).json();
  await page.request.put('/api/taste', { headers: { 'x-csrf-token': token }, data: { ...profile.settings, maxBookAgeYears: null } });
});
test.afterEach(async ({ page }) => {
  await page.unroute('**/api/taste');
  const { token } = await (await page.request.get('/api/auth/csrf')).json();
  const { profile } = await (await page.request.get('/api/taste')).json();
  await page.request.put('/api/taste', { headers: { 'x-csrf-token': token }, data: { ...profile.settings, maxBookAgeYears: null } });
});

test('saves a custom age, persists on reload, validates the API and can clear the limit', async ({ page }, info) => {
  const nav = page.getByRole('navigation', { name: info.project.name === 'mobile' ? 'Mobile navigation' : 'Primary', exact: true });
  await nav.getByRole('button', { name: 'Settings', exact: true }).click();
  const group = page.getByRole('group', { name: 'Book age', exact: true });
  const age = group.getByLabel('Maximum book age (years)');
  await expect(age).toHaveValue('');
  await age.fill('17'); await group.getByRole('button', { name: 'Save book age' }).click();
  await expect(page.getByText('Saved. Regenerate suggestions to apply these preferences.')).toBeVisible();
  const { profile } = await (await page.request.get('/api/taste')).json();
  expect(profile.settings.maxBookAgeYears).toBe(17);
  const { token } = await (await page.request.get('/api/auth/csrf')).json();
  expect((await page.request.put('/api/taste', { headers: { 'x-csrf-token': token }, data: { ...profile.settings, maxBookAgeYears: -1 } })).status()).toBe(400);
  await page.reload(); await nav.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(age).toHaveValue('17');
  await group.screenshot({ path: info.outputPath('book-age.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await age.fill('0'); await group.getByRole('button', { name: 'Save book age' }).click();
  await expect(group.getByText(/Current limit: 0 years/)).toBeVisible();
  await expect(page.getByText('Saved. Regenerate suggestions to apply these preferences.')).toBeVisible();
  await age.fill(''); await group.getByRole('button', { name: 'Save book age' }).click();
  await expect(page.getByText('Saved. Regenerate suggestions to apply these preferences.')).toBeVisible();
  expect((await (await page.request.get('/api/taste')).json()).profile.settings.maxBookAgeYears).toBeNull();
});

test('restores the saved limit when saving fails', async ({ page }, info) => {
  await page.getByRole('navigation', { name: info.project.name === 'mobile' ? 'Mobile navigation' : 'Primary', exact: true }).getByRole('button', { name: 'Settings', exact: true }).click();
  await page.route('**/api/taste', route => route.request().method() === 'PUT' ? route.fulfill({ status: 503, json: { error: 'Could not save book age. Please retry.' } }) : route.continue());
  await page.getByLabel('Maximum book age (years)').fill('20');
  await page.getByRole('button', { name: 'Save book age' }).click();
  await expect(page.getByText('Could not save book age. Please retry.')).toBeVisible();
  await expect(page.getByLabel('Maximum book age (years)')).toHaveValue('');
  await expect(page.getByText('Current limit: No limit.', { exact: true })).toBeVisible();
});
