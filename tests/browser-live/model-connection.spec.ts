import { expect, test } from '@playwright/test';

test('AI connection test requires owner and CSRF and explains missing configuration', async ({ request }) => {
  expect((await request.post('/api/integrations/model')).status()).toBe(401);
  await request.post('/api/auth/login', { data: { password: 'browser-test-password' } });
  expect((await request.post('/api/integrations/model')).status()).toBe(403);
  const { token } = await (await request.get('/api/auth/csrf')).json();
  const response = await request.post('/api/integrations/model', { headers: { 'x-csrf-token': token } });
  expect(response.status()).toBe(502);
  expect(await response.json()).toMatchObject({ ok: false, error: expect.stringContaining('AI model is not configured') });
});

test('Settings shows AI test progress, success, failure and permits retry', async ({ page }, info) => {
  let finish: (() => void) | undefined;
  let fail = false;
  await page.route('**/api/integrations/model', async route => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers()['x-csrf-token']).toBeTruthy();
    await new Promise<void>(resolve => { finish = resolve; });
    await route.fulfill(fail ? { status: 502, json: { ok: false, error: 'AI connection failed (HTTP 401). Check MODEL_API_KEY and access to the configured model.' } } : { json: { ok: true, model: 'test-model', elapsedMs: 1200 } });
  });
  await page.goto('/');
  await page.getByLabel('Password').fill('browser-test-password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.getByRole('navigation', { name: info.project.name === 'mobile' ? 'Mobile navigation' : 'Primary', exact: true }).getByRole('button', { name: 'Settings', exact: true }).click();
  const button = page.getByRole('button', { name: 'Test AI connection', exact: true });
  await button.click();
  await expect(page.getByRole('button', { name: 'Testing AI model…', exact: true })).toBeDisabled();
  await expect.poll(() => Boolean(finish)).toBe(true); finish!();
  await expect(page.getByText('AI model connected. test-model returned a valid response in 1.2 seconds.')).toBeVisible();
  await expect(button).toBeEnabled();
  await button.locator('..').screenshot({ path: info.outputPath('connection-tests.png') });
  fail = true; finish = undefined;
  await button.click();
  await expect.poll(() => Boolean(finish)).toBe(true); finish!();
  await expect(page.getByText(/AI connection failed \(HTTP 401\)/)).toBeVisible();
  await expect(button).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
