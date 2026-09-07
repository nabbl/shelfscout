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
  await expect(page.getByText('Use Refresh ratings to look up this book through BookOrbit.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What might put you off' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  item.caveat = 'The catalog describes a war, which conflicts with your preference to avoid war.';
  await page.reload();
  await expect(page.getByText(item.caveat)).toBeVisible();
});


test('Refresh ratings queues a lookup and polling displays live provider values', async ({page}) => {
  let queued = false;
  const item = {workKey:'ratings-fixture',editionKey:'/works/OL1W',title:'Live rating fixture',author:'Test Author',category:'discovery',subjects:[],why:'Fixture',caveat:'',ratings:{goodreads:{rating:null as number|null,count:100,status:'bookorbit',url:'https://www.goodreads.com/book/show/1',freshness:'Retrieved today via BookOrbit'},amazon:{rating:null}}};
  await page.route('**/api/recommendations',route=>route.fulfill({json:{last:{items:[item],rankingAdapter:'Fixture',diagnostics:{catalogPool:1}},ratingsJob:queued?{status:'complete'}:null}}));
  await page.route('**/api/recommendations/ratings', async route=>{expect(route.request().method()).toBe('POST');expect(route.request().headers()['x-csrf-token']).toBeTruthy();queued=true;item.ratings.goodreads.rating=4.25;await route.fulfill({status:202,json:{id:'ratings-job'}});});
  await page.goto('/');await page.getByLabel('Password').fill('browser-test-password');await page.getByRole('button',{name:/sign in/i}).click();
  await page.getByRole('button',{name:'Refresh ratings',exact:true}).click();
  await expect(page.getByText('4.25', { exact: true })).toBeVisible();
  await expect(page.getByRole('link',{name:'Goodreads reviews for Live rating fixture'})).toHaveAttribute('href','https://www.goodreads.com/book/show/1');
});


test('ratings refresh requires owner authentication and CSRF', async ({request}) => {
  expect((await request.post('/api/recommendations/ratings')).status()).toBe(401);
  await request.post('/api/auth/login',{data:{password:'browser-test-password'}});
  expect((await request.post('/api/recommendations/ratings')).status()).toBe(403);
});
