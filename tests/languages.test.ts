import { afterEach, expect, it, vi } from 'vitest';
import { createDatabase } from '../src/lib/db';
import { languageCode, languageQuery, preferredBookLanguage } from '../src/lib/languages';
import { settingsSchema, type CatalogBook } from '../src/lib/recommendation/types';
import { buildProfile, hash } from '../src/lib/recommendation/profile';
import { batchState, generateBatch, queueBatch, rankContext } from '../src/lib/recommendation/engine';
import { rankPool } from '../src/lib/recommendation/rank';
import { CATALOG_FIELDS, searchCatalog } from '../src/lib/recommendation/catalog';
import { startSeriesAtBookOne } from '../src/lib/recommendation/series';

const dbs: ReturnType<typeof createDatabase>[] = [];
afterEach(() => { dbs.splice(0).forEach(db => db.close()); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function setup() { const db = createDatabase(':memory:'); dbs.push(db); return db; }
const input = { mood: '', mode: 'refresh' as const, rereads: false };
const book = (id: number, language: string, languages?: string[]): CatalogBook => ({ key: `/works/OL${id}W`, title: `Book ${id}`, author: `Writer ${id}`, year: 2020, isbns: [], language, languages, coverUrl: null, subjects: ['memory'], description: 'A story about memory.', series: null, strategies: ['fixture'] });
const cache = (db: ReturnType<typeof setup>, key: string, data: unknown) => db.prepare('INSERT OR REPLACE INTO recommendation_cache VALUES(?,?,?)').run(key, JSON.stringify(data), '2099-01-01');
function cacheSearch(db: ReturnType<typeof setup>, query: string, docs: unknown[]) {
  const params = new URLSearchParams({ q: query, fields: CATALOG_FIELDS, limit: '40', page: '1' });
  cache(db, `catalog-v3:${hash(params.toString())}`, { docs, numFound: docs.length });
}

it('defaults existing profiles to English and requires at least one supported language', () => {
  expect(settingsSchema.parse({}).languages).toEqual(['en']);
  expect(settingsSchema.parse({ languages: ['en', 'de', 'en'] }).languages).toEqual(['en', 'de']);
  for (const languages of [[], ['und'], ['anything'], ['en OR *:*']]) expect(settingsSchema.safeParse({ languages }).success).toBe(false);
  expect(languageCode('ger')).toBe('de'); expect(languageCode('deu')).toBe('de');
  expect(languageCode('fre')).toBe('fr'); expect(languageCode('fra')).toBe('fr');
  expect(languageCode('en-US')).toBe('en'); expect(languageCode('pt_BR')).toBe('pt');
});

it('filters disallowed and unknown languages before ranking, and selects a permitted translation', () => {
  const db = setup(), profile = buildProfile(db), context = rankContext(db, input);
  const books = [book(1, 'eng'), book(2, 'fre'), book(3, 'und'), book(4, 'eng', ['eng', 'ger']), book(5, 'deu')];
  expect(rankPool(books, profile, context).map(book => book.catalogKey)).toEqual(['/works/OL1W', '/works/OL4W']);
  profile.settings.languages = ['de'];
  const german = rankPool(books, profile, context);
  expect(german.map(book => book.catalogKey)).toEqual(['/works/OL4W', '/works/OL5W']);
  expect(german.every(book => book.language === 'de')).toBe(true);
  expect(preferredBookLanguage({ language: 'und', languages: [] }, ['en'])).toBeNull();
});

it('retains all catalog languages and scopes discovery to allowed catalog codes', async () => {
  const db = setup(); vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network request'); }));
  const query = languageQuery('subject:"memory"', ['en', 'de']);
  expect(query).toBe('(subject:"memory") AND language:(eng OR ger OR deu)');
  cacheSearch(db, query, [{ key: '/works/OL1W', title: 'A Book', author_name: ['Writer'], language: ['fre', 'ger', 'eng'] }]);
  const [result] = await searchCatalog(db, { kind: 'theme', query, reason: 'Fixture' });
  expect(result.languages).toEqual(['fre', 'ger', 'eng']);
  expect(preferredBookLanguage(result, ['de'])).toBe('de');
  expect(fetch).not.toHaveBeenCalled();
});

it('applies new language settings to already completed batches without overwriting their stored results', () => {
  const db = setup(); const id = queueBatch(db, input);
  const profile = buildProfile(db); profile.settings.languages = ['en', 'fr'];
  const items = rankPool([book(1, 'eng'), book(2, 'fre'), book(3, 'eng', ['eng', 'ger'])], profile, rankContext(db, input));
  // Legacy batches have a single language and must also be filtered.
  delete items[0].languages;
  db.prepare("UPDATE recommendation_batches SET status='complete',result_json=?,completed_at='now' WHERE id=?").run(JSON.stringify({ items }), id);
  expect(batchState(db).last.items.map((book: { language: string }) => book.language)).toEqual(['en', 'en']);
  db.prepare('INSERT OR REPLACE INTO taste_profile VALUES(1,?,?)').run(JSON.stringify(settingsSchema.parse({ languages: ['de'] })), 'now');
  expect(batchState(db).last.items).toMatchObject([{ title: 'Book 3', language: 'de' }]);
  expect(JSON.parse((db.prepare('SELECT result_json FROM recommendation_batches WHERE id=?').get(id) as { result_json: string }).result_json).items).toHaveLength(3);
});

it('checks the language again when a series sequel is replaced by book one', async () => {
  const db = setup(); vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network request'); }));
  const series = { key: 'OL1L', name: 'Fixture', position: 2 };
  const sequel = { ...book(2, 'eng'), series: series.name, seriesMemberships: [series] };
  cacheSearch(db, 'series_key:OL1L', [{ key: '/works/OL1W', title: 'Book 1', author_name: ['Writer'], language: ['fre'], series_key: ['OL1L'], series_name: ['Fixture'], series_position: ['1'] }]);
  cache(db, 'work-v2:/works/OL1W', { key: '/works/OL1W', title: 'Book 1', description: 'First book.' });
  const result = await startSeriesAtBookOne(db, [sequel], true, () => {});
  expect(result.books).toHaveLength(1);
  expect(rankPool(result.books, buildProfile(db), rankContext(db, input))).toHaveLength(0);
});

it('enforces preferred languages in a generated batch even if catalog results ignore the search filter', async () => {
  const db = setup(); vi.stubEnv('MODEL_NAME', '');
  const fetcher = vi.fn(async (url: string) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/search.json') {
      expect(parsed.searchParams.get('q')).toContain('AND language:(eng)');
      return Response.json({ docs: ['eng', 'fre', undefined].map((language, index) => ({ key: `/works/OL${index + 1}W`, title: `Book ${index + 1}`, author_name: [`Writer ${index + 1}`], language: language ? [language] : [] })) });
    }
    return Response.json({ key: '/works/OL1W', title: 'Book 1', description: 'A story about memory.' });
  });
  vi.stubGlobal('fetch', fetcher);
  const id = queueBatch(db, input); await generateBatch(db, id);
  expect(batchState(db).last.items).toMatchObject([{ title: 'Book 1', language: 'en' }]);
});
