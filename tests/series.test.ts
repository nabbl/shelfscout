import { afterEach, expect, it, vi } from 'vitest';
import { createDatabase } from '../src/lib/db';
import { CATALOG_FIELDS, enrichBook, searchCatalog } from '../src/lib/recommendation/catalog';
import { hash, buildProfile } from '../src/lib/recommendation/profile';
import { primarySeries, seriesCatalog, seriesEligible, startSeriesAtBookOne } from '../src/lib/recommendation/series';
import { batchState, queueBatch, rankContext } from '../src/lib/recommendation/engine';
import { rankPool } from '../src/lib/recommendation/rank';
import { settingsSchema, type CatalogBook } from '../src/lib/recommendation/types';

const dbs: ReturnType<typeof createDatabase>[] = [];
afterEach(() => { dbs.splice(0).forEach(db => db.close()); vi.unstubAllGlobals(); });
const database = () => { const db = createDatabase(':memory:'); dbs.push(db); vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network request'); })); return db; };
const series = { key: 'OL123L', name: 'Fixture Chronicles', position: 2 };
const sequel: CatalogBook = { key: '/works/OL2W', title: 'The Return', author: 'Test Author', series: series.name, seriesMemberships: [series], year: 2002, subjects: ['memory'], description: 'A sequel about memory.', language: 'eng', isbns: [], coverUrl: null, strategies: ['theme'] };
const firstDoc = { key: '/works/OL1W', title: 'The Beginning', author_name: ['Test Author'], language: ['eng'], subject: ['friendship'], series_key: ['OL123L'], series_name: [series.name], series_position: ['1'] };
function cache(db: ReturnType<typeof database>, key: string, value: unknown) { db.prepare('INSERT OR REPLACE INTO recommendation_cache VALUES(?,?,?)').run(key, JSON.stringify(value), '2099-01-01'); }
function cacheSearch(db: ReturnType<typeof database>, docs: unknown[], total = docs.length, page = 1) { const params = new URLSearchParams({ q: 'series_key:OL123L', fields: CATALOG_FIELDS, limit: '40', page: String(page) }); cache(db, `catalog-v3:${hash(params.toString())}`, { docs, numFound: total }); }
function first(db: ReturnType<typeof database>) { cacheSearch(db, [firstDoc, { ...firstDoc, key: sequel.key, title: sequel.title, series_position: ['2'] }]); cache(db, 'work-v2:/works/OL1W', { key: '/works/OL1W', title: firstDoc.title, description: 'The beginning of a friendship.', subjects: ['friendship'] }); }

it('reads structured series fields and preserves them when enriching a work', async () => {
  const db = database(); first(db);
  const [book] = await searchCatalog(db, { kind: 'series', query: 'series_key:OL123L', reason: '' });
  expect(primarySeries(await enrichBook(db, book))).toEqual({ ...series, position: 1 });
});
it('replaces sequels with one verified starter and uses the starter’s own evidence', async () => {
  const db = database(); first(db);
  const result = await startSeriesAtBookOne(db, [sequel, { ...sequel, key: '/works/OL3W' }], true, vi.fn());
  expect(result.skipped).toBe(0); expect(result.books).toHaveLength(1);
  expect(result.books[0]).toMatchObject({ key: '/works/OL1W', title: firstDoc.title, description: 'The beginning of a friendship.', subjects: ['friendship'], strategies: ['theme'] });
  expect(fetch).not.toHaveBeenCalled();
});
it('omits known series when disabled and does not perform lookups', async () => {
  const db = database(); const standalone = { ...sequel, key: '/works/OL9W', series: null, seriesMemberships: [] };
  expect((await startSeriesAtBookOne(db, [sequel, standalone], false, vi.fn())).books).toEqual([standalone]);
  expect(fetch).not.toHaveBeenCalled();
});
it.each(['missing', 'ambiguous'])('withholds a series with a %s first-book identity', async kind => {
  const db = database(); cacheSearch(db, kind === 'missing' ? [{ ...firstDoc, series_position: ['2'] }] : [firstDoc, { ...firstDoc, key: '/works/OL9W' }]);
  expect((await startSeriesAtBookOne(db, [sequel], true, vi.fn())).books).toEqual([]);
});
it('resolves unknown positions and prequels to book one, never publication year', async () => {
  const db = database(); first(db);
  for (const position of [null, 0, 0.5]) expect((await startSeriesAtBookOne(db, [{ ...sequel, seriesMemberships: [{ ...series, position }] }], true, vi.fn())).books[0].key).toBe('/works/OL1W');
});
it('paginates the series and excludes results belonging to a different series', async () => {
  const db = database(); cacheSearch(db, [{ ...firstDoc, key: '/works/OL2W', series_position: ['2'] }, { ...firstDoc, series_key: ['OL999L'] }], 41); cacheSearch(db, [firstDoc], 41, 2);
  const result = await seriesCatalog(db, series, sequel.author);
  expect(result.complete).toBe(true); expect(result.books.map(b => b.key)).toEqual(['/works/OL1W', '/works/OL2W']);
});
it('still applies read, saved and dismissed exclusions to the replacement first book', async () => {
  const db = database(); first(db); const { books } = await startSeriesAtBookOne(db, [sequel], true, vi.fn());
  const context = rankContext(db, { mood: '', mode: 'refresh', rereads: false });
  context.known.add('/works/OL1W');
  expect(rankPool(books, buildProfile(db), context)).toHaveLength(0);
  expect(rankPool(books, buildProfile(db), { ...context, rereads: true })).toHaveLength(1);
  for (const field of ['saved', 'dismissed', 'requested'] as const) { context[field].add('/works/OL1W'); expect(rankPool(books, buildProfile(db), { ...context, rereads: true })).toHaveLength(0); context[field].clear(); }
});
it('filters old batches immediately for the series preference and missing order', () => {
  const db = database(), id = queueBatch(db, { mood: '', mode: 'refresh', rereads: false });
  const context = rankContext(db, { mood: '', mode: 'refresh', rereads: false });
  const items = rankPool([{ ...sequel, seriesMemberships: [{ ...series, position: 1 }] }, { ...sequel, key: '/works/OL8W', title: 'Unknown order', seriesMemberships: [] }], buildProfile(db), context);
  db.prepare("UPDATE recommendation_batches SET status='complete',completed_at='now',result_json=? WHERE id=?").run(JSON.stringify({ items }), id);
  expect(batchState(db).last.items).toHaveLength(1);
  db.prepare('INSERT OR REPLACE INTO taste_profile VALUES(1,?,?)').run(JSON.stringify(settingsSchema.parse({ allowSeries: false })), 'now');
  expect(batchState(db).last.items).toHaveLength(0);
  expect(seriesEligible({ series: 'Fixture Chronicles; Book 2' }, true)).toBe(false);
});

it('parses the live structured work-series shape without stringifying objects', async () => {
  const db = database();
  cache(db, 'work-v2:/works/OL2W', { key: sequel.key, title: sequel.title, series: [{ series: { key: '/series/OL123L' }, position: '2' }] });
  cache(db, 'series-name-v1:OL123L', { links: { self: '/series/OL123L' }, name: series.name });
  const book = await enrichBook(db, { ...sequel, series: '[object Object]', seriesMemberships: [] });
  expect(primarySeries(book)).toEqual(series);
  expect(book.series).not.toContain('[object Object]');
  expect(fetch).not.toHaveBeenCalled();
});

it('recognizes explicit series labels in subjects and numbered title suffixes without guessing order', async () => {
  const db = database();
  cache(db, 'work-v2:/works/OL2W', { key: sequel.key, title: sequel.title, subjects: ['series:Fixture Chronicles'] });
  const book = await enrichBook(db, { ...sequel, series: null, seriesMemberships: [] });
  expect(primarySeries(book)).toEqual({ key: null, name: series.name, position: null });
  expect(primarySeries({ title: 'The Return (Fixture Chronicles, #5)' })).toEqual({ key: null, name: series.name, position: 5 });
  expect(primarySeries({ title: 'A series of events', subjects: ['Fantasy'] })).toBeNull();
});

it('withholds legacy malformed series metadata until it can be refreshed', async () => {
  const db = database();
  const old = { ...sequel, series: '[object Object]', seriesMemberships: [] };
  expect(seriesEligible(old, true)).toBe(false);
  expect((await startSeriesAtBookOne(db, [old], true, vi.fn())).books).toEqual([]);
});
