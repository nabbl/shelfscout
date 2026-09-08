import { test, expect } from '@playwright/test';

test('stored ratings and useful caveats render while old boilerplate is hidden', async ({ page }) => {
  const item = { workKey: 'display-fixture', editionKey: '/works/OL1W', title: 'Display Fixture', author: 'Test Author', category: 'strong fit', subjects: ['memory'], why: 'A story about memory matches your preferences.', caveat: 'No specific conflict found in available evidence. Unmentioned traits remain unknown.', batchReason: 'Supported preferences with no evidenced tension; selected with author, series and theme diversity.', ratings: { goodreads: { rating: 4.17, count: null, status: 'import_snapshot', freshness: 'CSV imported 2026-09-07; original rating date unknown' }, amazon: { rating: null } } };
  await page.route('**/api/recommendations', route => route.fulfill({ json: { last: { items: [item], rankingAdapter: 'Fixture', diagnostics: { catalogPool: 1 } }, active: null } }));
  await page.goto('/');
  await page.getByLabel('Password').fill('browser-test-password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByText('4.17', { exact: true })).toBeVisible();
  await expect(page.getByText('CSV snapshot')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Amazon reviews for Display Fixture' })).toHaveAttribute('href', /amazon.com/);
  await expect(page.getByText(item.caveat)).toHaveCount(0);
  await expect(page.getByText(item.batchReason)).toHaveCount(0);
  await page.getByRole('button', { name: 'Why this book?' }).click();
  await expect(page.getByText(/CSV imported 2026-09-07/)).toBeVisible();
  await expect(page.getByText('Ratings are looked up automatically for new suggestions when BookOrbit is connected.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What might put you off' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Why this batch' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  item.caveat = 'The catalog describes a war, which conflicts with your preference to avoid war.';
  item.batchReason = 'This pick explores a new author while retaining your interest in memory.';
  await page.reload();
  await expect(page.getByText(item.caveat)).toBeVisible();
  await page.getByRole('button', { name: 'Why this book?' }).click();
  await expect(page.getByRole('heading', { name: 'Why this batch' })).toBeVisible();
  await expect(page.getByText(item.batchReason, { exact: true })).toBeVisible();
});


test('regeneration is the single primary action and shows progress while automatic ratings update', async ({page}, info) => {
  let state = 'idle';
  let stage = 'Searching catalog 3/8';
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const item = {workKey:'ratings-fixture',editionKey:'/works/OL1W',title:'Live rating fixture',author:'Test Author',category:'discovery',subjects:[],why:'Fixture',caveat:'',ratings:{goodreads:{rating:null as number|null,count:100,status:'bookorbit',url:'https://www.goodreads.com/book/show/1',freshness:'Retrieved today via BookOrbit'},amazon:{rating:null}}};
  await page.route('**/api/recommendations', async route => {
    if (route.request().method() === 'POST') {
      expect(route.request().headers()['x-csrf-token']).toBeTruthy();
      expect(route.request().postDataJSON().mode).toBe('refresh');
      state = 'queued'; return route.fulfill({ status: 202, json: { id: 'new-batch' } });
    }
    return route.fulfill({json:{last:{items:[item],rankingAdapter:'Fixture',diagnostics:{catalogPool:1}},active:['queued','running'].includes(state) ? {status:state,stage} : null,ratingsJob:state === 'complete' ? {status:'complete'} : null}});
  });
  await page.goto('/');await page.getByLabel('Password').fill('browser-test-password');await page.getByRole('button',{name:/sign in/i}).click();
  const regenerate = page.getByRole('button',{name:'Regenerate suggestions',exact:true});
  await expect(regenerate).toBeVisible();
  await expect(page.locator('.discover-actions button')).toHaveCount(1);
  await expect(page.getByRole('button',{name:/^(More picks|Refresh ratings)$/i})).toHaveCount(0);
  await page.screenshot({path:info.outputPath('regenerate-suggestions.png'),fullPage:false});
  await regenerate.click();
  await expect(page.getByRole('button',{name:'Generating suggestions…',exact:true})).toBeDisabled();
  const progress = page.getByRole('progressbar', { name: 'Suggestion generation' });
  await expect(progress).toHaveAttribute('aria-valuetext', /Waiting to start/);
  await expect(progress).toHaveAttribute('aria-valuenow', '0');
  state = 'running';
  await expect(progress).toHaveAttribute('aria-valuenow', '31');
  await expect(page.locator('.regenerate-fill')).toHaveAttribute('style', /width: 31%/);
  await page.screenshot({path:info.outputPath('regeneration-progress.png'),fullPage:false});
  stage = 'Reading catalog evidence 3/4';
  await page.reload();
  await expect(progress).toHaveAttribute('aria-valuenow', '65');
  await expect(page.getByRole('button',{name:'Generating suggestions…',exact:true})).toBeDisabled();
  item.ratings.goodreads.rating=4.25; state='complete';
  await expect(page.getByText('4.25', { exact: true })).toBeVisible();
  await expect(regenerate).toBeEnabled();
  await expect(progress).toHaveCount(0);
  await expect(page.getByRole('link',{name:'Goodreads reviews for Live rating fixture'})).toHaveAttribute('href','https://www.goodreads.com/book/show/1');
});

test('ratings refresh requires owner authentication and CSRF', async ({request}) => {
  expect((await request.post('/api/recommendations/ratings')).status()).toBe(401);
  await request.post('/api/auth/login',{data:{password:'browser-test-password'}});
  expect((await request.post('/api/recommendations/ratings')).status()).toBe(403);
});

test('Discover exposes AI fallback and renders the specific explanation after successful generation', async ({ page }) => {
  let aiAvailable = false;
  const specific = 'A healer torn between saving her city and protecting its exiles puts your interest in moral dilemmas at the heart of the story.';
  await page.route('**/api/recommendations', route => route.fulfill({ json: {
    active: null,
    last: { items: [{ workKey: 'explanation-fixture', editionKey: '/works/OL1W', title: 'A Divided City', author: 'Fixture Writer', category: 'matches your interests', subjects: ['Fantasy fiction'], why: aiAvailable ? specific : 'This overlaps with your preferred genres, but a more personal match is not established by the available evidence.' }],
      rankingAdapter: aiAvailable ? 'AI-assisted' : 'deterministic evidence fallback',
      diagnostics: { catalogPool: 1, modelAssessed: aiAvailable ? 1 : 0 },
      warnings: aiAvailable ? [] : ['AI candidate assessment 1 unavailable: model HTTP 401; check the AI connection in Settings. Basic catalog matches retained.'],
    },
  } }));
  await page.goto('/');
  await page.getByLabel('Password').fill('browser-test-password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByText(/AI matching was unavailable for this batch/)).toBeVisible();
  aiAvailable = true;
  await page.reload();
  await expect(page.getByText(specific, { exact: true })).toBeVisible();
  await expect(page.getByText(/AI matching was unavailable for this batch/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Why this book?' }).click();
  await expect(page.getByRole('dialog').getByText(specific, { exact: true })).toBeVisible();
});
