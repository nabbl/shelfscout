import { afterEach, expect, it, vi } from 'vitest';
import { createDatabase } from '../src/lib/db';
import { CATALOG_FIELDS, catalogJson, resolveSeriesWork } from '../src/lib/recommendation/catalog';
import { browseSeries } from '../src/lib/recommendation/series-browse';
import { hash } from '../src/lib/recommendation/profile';
import { submitAcquisitions } from '../src/lib/acquisition';
import { workKey } from '../src/lib/identity';

const dbs: ReturnType<typeof createDatabase>[] = [];
afterEach(() => { dbs.splice(0).forEach(db => db.close()); vi.unstubAllGlobals(); });
const series = { key: 'OL123L', name: 'Fixture Chronicles', position: 5 };
const doc = { key: '/works/OL5W', title: 'The Return', author_name: ['Test Writer'], series_key: ['OL123L'], series_name: [series.name], series_position: ['5'], language: ['eng'] };
const first = { ...doc, key: '/works/OL1W', title: 'The Beginning', series_position: ['1'] };
function setup() { const db = createDatabase(':memory:'); dbs.push(db); vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network request'); })); return db; }
function cache(db: ReturnType<typeof setup>, key: string, value: unknown) { db.prepare('INSERT OR REPLACE INTO recommendation_cache VALUES(?,?,?)').run(key, JSON.stringify(value), '2099-01-01'); }
function search(db: ReturnType<typeof setup>, query: string, docs: unknown[], total = docs.length, page = 1) { const params = new URLSearchParams({ q: query, fields: CATALOG_FIELDS, limit: '40', page: String(page) }); cache(db, `catalog-v3:${hash(params.toString())}`, { docs, numFound: total }); }

it('resolves and browses a sequel without fetching unrelated description or author metadata', async () => {
  const db = setup(); search(db, 'key:"/works/OL5W"', [doc]); search(db, 'series_key:OL123L', [doc, first]);
  const result = await browseSeries(db, doc.key);
  expect(result).toMatchObject({ series, complete: true, stale: false });
  expect(result.books.map(book => book.key)).toEqual([first.key, doc.key]);
  expect(result.books[0]).toMatchObject({ title: first.title, language: 'eng', position: 1 });
  expect(fetch).not.toHaveBeenCalled();
  expect(db.prepare('SELECT count(*) n FROM acquisitions').get()).toEqual({ n: 0 });
});

it('resolves direct work records when a work is not yet present in search', async () => {
  const db = setup(); search(db, 'key:"/works/OL5W"', []);
  cache(db, 'work-v2:/works/OL5W', { key: doc.key, title: doc.title, authors: [{ author: { key: '/authors/OL1A' } }], series: [{ series: { key: '/series/OL123L' }, position: '5' }] });
  cache(db, 'author-v1:/authors/OL1A', { key: '/authors/OL1A', name: 'Test Writer' });
  cache(db, 'series-name-v1:OL123L', { links: { self: '/series/OL123L' }, name: series.name });
  expect(await resolveSeriesWork(db, doc.key)).toMatchObject({ key: doc.key, author: 'Test Writer', seriesMemberships: [series] });
  expect(fetch).not.toHaveBeenCalled();
});

it('recomputes read, requested and known ownership markers when serving a cached series', async () => {
  const db = setup(); search(db, 'key:"/works/OL5W"', [doc]); search(db, 'series_key:OL123L', [first, doc]);
  await browseSeries(db, doc.key);
  const requested = submitAcquisitions(db, [{ title: first.title, author: 'Test Writer', language: 'eng', providerId: first.key }], '12');
  db.prepare("UPDATE acquisitions SET upstream_book_id='42' WHERE id=?").run(requested[0].acquisition!.id);
  db.prepare('INSERT INTO companion_ratings(work_key,rating,updated_at) VALUES(?,?,?)').run(workKey(doc.title, 'Test Writer'), 4, 'now');
  const result = await browseSeries(db, doc.key);
  expect(result.books[0]).toMatchObject({ owned: true, requested: true, read: false });
  expect(result.books[1]).toMatchObject({ owned: false, requested: false, read: true });
  expect(fetch).not.toHaveBeenCalled();
});

it('returns a labelled previous list when refresh fails, without persisting an empty replacement', async () => {
  const db = setup();
  const previous = { series, complete: true, stale: false, checkedAt: new Date(Date.now() - 2 * 86400000).toISOString(), message: 'Previous list', books: [{ key: first.key, title: first.title, author: 'Test Writer', position: 1, sourceUrl: `https://openlibrary.org${first.key}` }] };
  cache(db, `series-browse-v1:${doc.key}`, previous);
  // Invalid cached responses exercise failure without any live calls or waits.
  const params = new URLSearchParams({ q: 'key:"/works/OL5W"', fields: CATALOG_FIELDS, limit: '40', page: '1' });
  cache(db, `catalog-v3:${hash(params.toString())}`, {});
  cache(db, `work-v2:${doc.key}`, { key: '/works/OL99W' });
  const result = await browseSeries(db, doc.key);
  expect(result).toMatchObject({ complete: true, stale: true, checkedAt: previous.checkedAt });
  expect(result.books[0].key).toBe(first.key);
  expect(result.message).toContain('previously checked');
  expect(JSON.parse((db.prepare('SELECT value_json FROM recommendation_cache WHERE key=?').get(`series-browse-v1:${doc.key}`) as { value_json: string }).value_json).message).toBe('Previous list');
});

it('keeps a partial series usable without declaring the scan complete', async () => {
  const db = setup(); search(db, 'key:"/works/OL5W"', [doc]); search(db, 'series_key:OL123L', [doc, first], 41);
  const params = new URLSearchParams({ q: 'series_key:OL123L', fields: CATALOG_FIELDS, limit: '40', page: '2' });
  cache(db, `catalog-v3:${hash(params.toString())}`, {});
  const result = await browseSeries(db, doc.key);
  expect(result.complete).toBe(false); expect(result.books).toHaveLength(2);
  expect(result.message).toContain('Only part');
});

it('retries transient read failures once and does not retry rate limits', async () => {
  const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(Response.json({ key: doc.key }));
  vi.stubGlobal('fetch', fetchMock);
  expect(await catalogJson(`${doc.key}.json`)).toEqual({ key: doc.key });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  fetchMock.mockReset().mockResolvedValue(new Response('', { status: 429 }));
  await expect(catalogJson(`${doc.key}.json`)).rejects.toThrow('limiting requests');
  expect(fetchMock).toHaveBeenCalledTimes(1);
}, 15000);
