import { expect, test } from '@playwright/test';
import { settingsSchema } from '../../src/lib/recommendation/types';

const item = { workKey: 'series-fixture', editionKey: '/works/OL1W', title: 'A Beginning', author: 'Test Author', language: 'en', category: 'strong fit', subjects: ['memory'], why: 'Fixture', caveat: '', series: 'Fixture Chronicles', seriesMemberships: [{ key: 'OL123L', name: 'Fixture Chronicles', position: 1 }] };
const moods = [{ id: 'reflective', label: 'Thoughtful & reflective', query: 'memory', reason: 'From themes in Remembered City.', books: ['Remembered City'] }, { id: 'adventurous', label: 'An adventure', query: 'adventure', reason: 'From your preference for adventure.', books: [] }];

test('history-based moods select, clear, remove and restore on desktop and mobile', async ({ page }, testInfo) => {
  let hidden: string[] = [];
  let selected = '';
  await page.route('**/api/taste', async route => {
    if (route.request().method() === 'PATCH') { expect(route.request().headers()['x-csrf-token']).toBeTruthy(); const body = route.request().postDataJSON(); hidden = body.restoreMoods ? [] : [...hidden, body.hideMood]; return route.fulfill({ json: { ok: true } }); }
    return route.fulfill({ json: { profile: { settings: settingsSchema.parse({ hiddenMoods: hidden }) }, moods: moods.filter(m => !hidden.includes(m.id)) } });
  });
  await page.route('**/api/recommendations', route => {
    if (route.request().method() === 'POST') { selected = route.request().postDataJSON().mood; return route.fulfill({ status: 202, json: { id: 'job' } }); }
    return route.fulfill({ json: { last: { id: 'batch', mood: selected, items: [item], rankingAdapter: 'Fixture', diagnostics: { catalogPool: 1 } } } });
  });
  await page.goto('/'); await page.getByLabel('Password').fill('browser-test-password'); await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByText('From themes in Remembered City.')).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Add a mood' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Thoughtful & reflective', exact: true }).click();
  await expect.poll(() => selected).toBe('memory');
  await expect(page.getByRole('button', { name: 'Thoughtful & reflective', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Clear mood' }).click();
  await expect.poll(() => selected).toBe('');
  const remove = page.getByRole('button', { name: 'Remove Thoughtful & reflective suggestion' });
  const size = await remove.boundingBox(); expect(size!.width).toBeGreaterThanOrEqual(44); expect(size!.height).toBeGreaterThanOrEqual(44);
  await remove.click(); await expect(page.getByRole('button', { name: 'Thoughtful & reflective', exact: true })).toHaveCount(0);
  await page.reload(); await expect(page.getByRole('button', { name: 'Restore hidden moods' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Thoughtful & reflective', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Restore hidden moods' }).click(); await expect(page.getByRole('button', { name: 'Thoughtful & reflective', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({ path: testInfo.outputPath('mood-suggestions.png'), fullPage: true });
});

test('series preference persists and details show ordered members with read markers', async ({ page }, testInfo) => {
  let settings = settingsSchema.parse({});
  await page.route('**/api/taste', route => {
    if (route.request().method() === 'PUT') settings = settingsSchema.parse(route.request().postDataJSON());
    return route.fulfill({ json: { profile: { settings, preferences: [], evidence: [], unknown: [] }, moods: [], lastModelPreferences: [] } });
  });
  await page.route('**/api/recommendations', route => route.fulfill({ json: { last: { items: settings.allowSeries ? [item] : [], rankingAdapter: 'Fixture', diagnostics: { catalogPool: 1 } } } }));
  await page.route('**/api/recommendations/series?*', route => route.fulfill({ json: { series: item.seriesMemberships[0], complete: true, message: 'Catalog order shown where known. Series coverage may be incomplete.', books: [{ key: '/works/OL1W', title: item.title, author: item.author, position: 1, sourceUrl: 'https://openlibrary.org/works/OL1W', read: true }, { key: '/works/OL2W', title: 'The Next Chapter', author: item.author, position: 2, sourceUrl: 'https://openlibrary.org/works/OL2W' }] } }));
  await page.goto('/'); await page.getByLabel('Password').fill('browser-test-password'); await page.getByRole('button', { name: /sign in/i }).click();
  await page.getByRole('button', { name: 'Why this book?' }).click(); await page.getByRole('button', { name: 'Show series', exact: true }).click();
  await expect(page.getByRole('link', { name: 'The Next Chapter ↗' })).toHaveAttribute('href', 'https://openlibrary.org/works/OL2W');
  await expect(page.getByText('Test Author · Already read · This book')).toBeVisible();
  await page.getByRole('button', { name: 'Hide series' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('series-details.png'), fullPage: false });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('navigation', { name: testInfo.project.name === 'mobile' ? 'Mobile navigation' : 'Primary', exact: true }).getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Allow books that are part of a series' }).uncheck();
  await expect.poll(() => settings.allowSeries).toBe(false);
  await page.reload();
  await page.getByRole('navigation', { name: testInfo.project.name === 'mobile' ? 'Mobile navigation' : 'Primary', exact: true }).getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Allow books that are part of a series' })).not.toBeChecked();
});

test('series reads require ownership and mood changes require CSRF and persist', async ({ request }) => {
  expect((await request.get('/api/recommendations/series?work=/works/OL1W')).status()).toBe(401);
  expect((await request.patch('/api/taste', { data: { hideMood: 'reflective' } })).status()).toBe(401);
  await request.post('/api/auth/login', { data: { password: 'browser-test-password' } });
  expect((await request.patch('/api/taste', { data: { hideMood: 'reflective' } })).status()).toBe(403);
  expect((await request.get('/api/recommendations/series?work=https://example.org')).status()).toBe(400);
  const { token } = await (await request.get('/api/auth/csrf')).json();
  const before = (await (await request.get('/api/taste')).json()).profile.settings;
  try {
    expect((await request.patch('/api/taste', { headers: { 'x-csrf-token': token }, data: { hideMood: 'reflective' } })).status()).toBe(200);
    const saved = (await (await request.get('/api/taste')).json()).profile.settings;
    expect(saved.hiddenMoods).toContain('reflective'); expect(saved.preferences).toEqual(before.preferences); expect(saved.allowSeries).toBe(before.allowSeries);
  } finally {
    await request.put('/api/taste', { headers: { 'x-csrf-token': token }, data: before });
  }
});
