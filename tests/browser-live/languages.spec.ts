import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/'); await page.getByLabel('Password').fill('browser-test-password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByText('PRIVATE · LIVE DATA')).toBeVisible();
  const { token } = await (await page.request.get('/api/auth/csrf')).json();
  const { profile } = await (await page.request.get('/api/taste')).json();
  await page.request.put('/api/taste', { headers: { 'x-csrf-token': token }, data: { ...profile.settings, languages: ['en'] } });
});
test.afterEach(async ({ page }) => {
  const { token } = await (await page.request.get('/api/auth/csrf')).json();
  const { profile } = await (await page.request.get('/api/taste')).json();
  await page.request.put('/api/taste', { headers: { 'x-csrf-token': token }, data: { ...profile.settings, languages: ['en'] } });
});

test('search belongs only to History, and language settings persist with at least one selected', async ({ page }, info) => {
  const nav = page.getByRole('navigation', { name: info.project.name === 'mobile' ? 'Mobile navigation' : 'Primary', exact: true });
  await expect(page.locator('.topbar input')).toHaveCount(0);
  await expect(page.getByLabel('Search books')).toHaveCount(0);
  await nav.getByRole('button', { name: 'History', exact: true }).click();
  const search = page.locator('.data-page').getByLabel('Search books');
  await search.fill('A book to find'); await expect(search).toBeVisible();
  await page.screenshot({ path: info.outputPath('history-search.png'), fullPage: true });
  await nav.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Search books')).toHaveCount(0);
  const languages = page.getByRole('group', { name: 'Reading languages', exact: true });
  const english = languages.getByRole('checkbox', { name: 'English', exact: true });
  const german = languages.getByRole('checkbox', { name: 'German', exact: true });
  await expect(english).toBeChecked(); await expect(english).toBeDisabled();
  await german.check();
  await expect(english).toBeEnabled(); await english.uncheck();
  await expect(german).toBeDisabled();
  await expect(languages.getByText(/Selected: German\./)).toBeVisible();
  await expect(page.locator('.taste-editor > [role="status"]')).toHaveText('Saved. Regenerate suggestions to apply these preferences.');
  const { profile } = await (await page.request.get('/api/taste')).json();
  expect(profile.settings.languages).toEqual(['de']);
  const { token } = await (await page.request.get('/api/auth/csrf')).json();
  expect((await page.request.put('/api/taste', { headers: { 'x-csrf-token': token }, data: { ...profile.settings, languages: [] } })).status()).toBe(400);
  await page.reload(); await nav.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(german).toBeChecked(); await expect(english).not.toBeChecked();
  await languages.screenshot({ path: info.outputPath('reading-languages.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('failed language saves show an error and restore the saved selection', async ({ page }, info) => {
  await page.getByRole('navigation', { name: info.project.name === 'mobile' ? 'Mobile navigation' : 'Primary', exact: true }).getByRole('button', { name: 'Settings', exact: true }).click();
  await page.route('**/api/taste', route => route.request().method() === 'PUT' ? route.fulfill({ status: 503, json: { error: 'Preferences could not be saved. Please retry.' } }) : route.continue());
  const languages = page.getByRole('group', { name: 'Reading languages', exact: true });
  await languages.getByRole('checkbox', { name: 'German', exact: true }).check();
  await expect(page.getByText('Preferences could not be saved. Please retry.')).toBeVisible();
  await expect(languages.getByRole('checkbox', { name: 'English', exact: true })).toBeChecked();
  await expect(languages.getByRole('checkbox', { name: 'German', exact: true })).not.toBeChecked();
  await page.unroute('**/api/taste');
  await languages.getByRole('checkbox', { name: 'German', exact: true }).check();
  await expect(page.getByText('Saved. Regenerate suggestions to apply these preferences.')).toBeVisible();
});
