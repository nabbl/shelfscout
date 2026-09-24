import { afterEach, expect, it, vi } from 'vitest';
import { createDatabase } from '../src/lib/db';
import { languageQuery } from '../src/lib/languages';
import { settingsSchema, type CatalogBook } from '../src/lib/recommendation/types';
import { buildProfile, hash, readSettings } from '../src/lib/recommendation/profile';
import { batchState, generateBatch, queueBatch, rankContext } from '../src/lib/recommendation/engine';
import { rankPool } from '../src/lib/recommendation/rank';
import { CATALOG_FIELDS, defaultStrategies } from '../src/lib/recommendation/catalog';
import { publicationAgeEligible, publicationAgeQuery } from '../src/lib/recommendation/publication-age';

const dbs: ReturnType<typeof createDatabase>[] = [];
afterEach(() => { dbs.splice(0).forEach(db => db.close()); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });
function setup() { const db = createDatabase(':memory:'); dbs.push(db); return db; }
const input = { mood: '', mode: 'refresh' as const, rereads: false };
const book = (id: number, year: number | null): CatalogBook => ({ key: `/works/OL${id}W`, title: `Book ${id}`, author: `Writer ${id}`, year, isbns: [], language: 'eng', coverUrl: null, subjects: ['memory'], description: 'A story about memory.', series: null, strategies: ['fixture'] });
const save = (db: ReturnType<typeof setup>, maxBookAgeYears: number | null) => db.prepare('INSERT OR REPLACE INTO taste_profile VALUES(1,?,?)').run(JSON.stringify(settingsSchema.parse({ maxBookAgeYears })), 'now');
const cache = (db: ReturnType<typeof setup>, key: string, data: unknown) => db.prepare('INSERT OR REPLACE INTO recommendation_cache VALUES(?,?,?)').run(key, JSON.stringify(data), '2099-01-01');
function cacheSearch(db: ReturnType<typeof setup>, query: string, docs: unknown[]) {
  const params = new URLSearchParams({ q: query, fields: CATALOG_FIELDS, limit: '40', page: '1' });
  cache(db, `catalog-v3:${hash(params.toString())}`, { docs, numFound: docs.length });
}

it('preserves unlimited legacy settings and validates a whole nonnegative number of years', () => {
  const db = setup();
  db.prepare('INSERT INTO taste_profile VALUES(1,?,?)').run(JSON.stringify({ languages: ['de'], allowSeries: false }), 'now');
  expect(readSettings(db)).toMatchObject({ maxBookAgeYears: null, languages: ['de'], allowSeries: false });
  for (const value of [null, 0, 1, 20, 10000]) expect(settingsSchema.parse({ maxBookAgeYears: value }).maxBookAgeYears).toBe(value);
  for (const value of [-1, 2.5, '20', '', true, 10001]) expect(settingsSchema.safeParse({ maxBookAgeYears: value }).success).toBe(false);
});

it('uses inclusive calendar-year boundaries and excludes unknown, invalid and future years with a limit', () => {
  for (const year of [2006, 2025, 2026]) expect(publicationAgeEligible({ year }, 20, 2026)).toBe(true);
  for (const year of [1800, 2005, 2027, null, undefined, NaN, 2020.5]) expect(publicationAgeEligible({ year }, 20, 2026)).toBe(false);
  expect(publicationAgeEligible({ year: 2026 }, 0, 2026)).toBe(true);
  expect(publicationAgeEligible({ year: 2025 }, 0, 2026)).toBe(false);
  expect(publicationAgeEligible({}, null, 2026)).toBe(true);
  expect(publicationAgeEligible({ year: 1800 }, null, 2026)).toBe(true);
  expect(publicationAgeQuery('subject:memory OR subject:adventure', 20, 2026)).toBe('(subject:memory OR subject:adventure) AND first_publish_year:[2006 TO 2026]');
  expect(publicationAgeQuery('subject:memory', null, 2026)).toBe('subject:memory');
});

it('applies age before ranking and refilters saved batches without destroying their results', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-24T12:00:00Z'));
  const db = setup(), profile = buildProfile(db), context = rankContext(db, input);
  const books = [book(1, 2006), book(2, 2026), book(3, 1800), book(4, null), book(5, 2027)];
  const items = rankPool(books, profile, context);
  profile.settings.maxBookAgeYears = 20;
  expect(rankPool(books, profile, context).map(b => b.year)).toEqual([2006, 2026]);
  const id = queueBatch(db, input);
  db.prepare("UPDATE recommendation_batches SET status='complete',result_json=?,completed_at='now' WHERE id=?").run(JSON.stringify({ items }), id);
  save(db, 20);
  expect(batchState(db).last.items.map((b: { year: number }) => b.year)).toEqual([2006, 2026]);
  vi.setSystemTime(new Date('2027-01-01T00:00:00Z'));
  expect(batchState(db).last.items.map((b: { year: number }) => b.year)).toEqual([2026, 2027]);
  save(db, null);
  expect(batchState(db).last.items).toHaveLength(5);
});

it.each([false, true])('enforces age throughout generation including replacement series starters (empty=%s)', async empty => {
  const db = setup(); save(db, 20); vi.stubEnv('MODEL_NAME', '');
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network request'); }));
  const year = new Date().getUTCFullYear();
  const docs = [
    { key: '/works/OL1W', title: 'Recent book', author_name: ['Recent Writer'], first_publish_year: year },
    { key: '/works/OL2W', title: 'Classic reprinted recently', author_name: ['Classic Writer'], first_publish_year: 1800, publish_year: [year] },
    { key: '/works/OL3W', title: 'Unknown year', author_name: ['Unknown Writer'] },
    { key: '/works/OL4W', title: 'Recent sequel', author_name: ['Series Writer'], first_publish_year: year, series_key: ['OL1L'], series_name: ['Fixture Series'], series_position: ['2'] },
  ].filter(d => !empty || d.key !== '/works/OL1W').map(d => ({ ...d, language: ['eng'] }));
  // Deliberately include out-of-range results: the catalog is not trusted to enforce the query.
  const profile = buildProfile(db);
  for (const strategy of defaultStrategies(profile, '')) cacheSearch(db, publicationAgeQuery(languageQuery(strategy.query, ['en']), 20), docs);
  for (const doc of docs) cache(db, `work-v2:${doc.key}`, { key: doc.key, title: doc.title, description: 'Fixture description.' });
  cacheSearch(db, 'series_key:OL1L', [{ key: '/works/OL5W', title: 'Old first book', author_name: ['Series Writer'], language: ['eng'], first_publish_year: 1800, series_key: ['OL1L'], series_name: ['Fixture Series'], series_position: ['1'] }]);
  cache(db, 'work-v2:/works/OL5W', { key: '/works/OL5W', title: 'Old first book', description: 'Series begins here.' });
  const id = queueBatch(db, input); await generateBatch(db, id);
  const result = batchState(db).last;
  expect(result.items.map((b: { title: string }) => b.title)).toEqual(empty ? [] : ['Recent book']);
  expect(result.warnings.join(' ')).toContain('first publication year');
  if (empty) expect(result.warnings.join(' ')).toContain('Book age in Settings');
  expect(fetch).not.toHaveBeenCalled();
});

it('reports no matching books rather than a connectivity failure when filtered searches are empty', async () => {
  const db = setup(); save(db, 0); vi.stubEnv('MODEL_NAME', '');
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network request'); }));
  for (const strategy of defaultStrategies(buildProfile(db), '')) cacheSearch(db, publicationAgeQuery(languageQuery(strategy.query, ['en']), 0), []);
  const id = queueBatch(db, input); await generateBatch(db, id);
  const state = batchState(db);
  expect(state.active).toMatchObject({ status: 'complete', error: null });
  expect(state.last.items).toEqual([]);
  expect(state.last.warnings.join(' ')).toContain('Book age in Settings');
  expect(fetch).not.toHaveBeenCalled();
});
