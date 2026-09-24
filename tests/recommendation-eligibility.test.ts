import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../src/lib/db';
import { languageQuery } from '../src/lib/languages';
import { CATALOG_FIELDS, defaultStrategies } from '../src/lib/recommendation/catalog';
import { discoveryQuery, recommendationEligible } from '../src/lib/recommendation/eligibility';
import { batchState, generateBatch, queueBatch, rankContext } from '../src/lib/recommendation/engine';
import { buildProfile, hash } from '../src/lib/recommendation/profile';
import { rankPool } from '../src/lib/recommendation/rank';
import { settingsSchema, type Assessment, type CatalogBook, type Preference } from '../src/lib/recommendation/types';

const preference = (value: string, direction: 'prefer' | 'avoid' = 'prefer'): Preference => ({ id: value, value, direction, dimension: 'theme', origin: 'explicit', confidence: 'supported', support: ['owner'], counterexamples: [] });
const preferences = [preference('science fiction'), preference('fantasy'), preference('romantasy', 'avoid')];
const taste = { preferences };
const book = (changes: Partial<CatalogBook> = {}): CatalogBook => ({ key: '/works/OL1W', title: 'A Distant Signal', author: 'A Writer', year: 2020, isbns: [], language: 'eng', coverUrl: null, subjects: ['Science fiction'], description: 'An engineer deciphers a signal from a distant civilization.', series: null, strategies: [], ...changes });
const input = { mood: '', mode: 'refresh' as const, rereads: false };
const dbs: ReturnType<typeof createDatabase>[] = [];
function setup() {
  const db = createDatabase(':memory:'); dbs.push(db);
  db.prepare('INSERT INTO taste_profile VALUES(1,?,?)').run(JSON.stringify(settingsSchema.parse({ preferences })), 'now');
  return db;
}
afterEach(() => { dbs.splice(0).forEach(db => db.close()); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('genre-focused reading eligibility', () => {
  // Representative metadata for the reported failure cases, not live catalog snapshots.
  it.each([
    book({ title: 'The Wesleyan anthology of science fiction', subjects: ['American Science fiction'] }),
    book({ title: 'The mammoth encyclopedia of science fiction', subjects: ['Science fiction'] }),
    book({ title: 'The Big Book of Science Fiction', subjects: ['Science fiction', 'Short stories'] }),
    book({ title: 'An Innocuous Title', subjects: ['Science fiction', 'History and criticism'] }),
    book({ title: 'Collected Voices', description: 'An anthology of speculative fiction by many authors.' }),
    book({ title: 'Other Worlds', description: 'A collection of eighteen science fiction short stories.' }),
  ])('withholds $title even with positive genre tags and a flattering AI assessment', b => {
    const db = setup(), profile = buildProfile(db);
    const ai: Assessment = { key: b.key, matches: [{ preferenceId: 'science fiction', quote: b.subjects[0], field: 'subjects', interpretation: 'This matches your favorite genre.' }], risks: [], mood: null };
    expect(recommendationEligible(b, taste)).toBe(false);
    expect(rankPool([b], profile, rankContext(db, input), [ai])).toEqual([]);
  });

  it.each(['Romantasy', 'Romantic fantasy', 'Fantasy romance'])('honors avoid romantasy under the label %s', subject => {
    expect(recommendationEligible(book({ subjects: ['Fantasy', subject] }), taste)).toBe(false);
  });
  it('uses romance genre classifications, not the mere presence of relationships', () => {
    expect(recommendationEligible(book({ subjects: ['Fiction, fantasy, general', 'Fiction, romance, general'] }), taste)).toBe(false);
    expect(recommendationEligible(book({ subjects: ['Fantasy'], description: 'A wizard and her husband defend their city. Love and friendship sustain them.' }), taste)).toBe(true);
    expect(recommendationEligible(book({ subjects: ['Fantasy'], description: 'A fantasy novel without romance.' }), taste)).toBe(true);
  });
  it('withholds an evidenced AI genre conflict even when mood and other matches are strong', () => {
    const db = setup(), b = book({ subjects: ['Fantasy'], description: 'A romance between a witch and a prince drives the entire story.' });
    const ai: Assessment = { key: b.key, matches: [], risks: [{ preferenceId: 'romantasy', field: 'description', quote: b.description, interpretation: 'The central plot is a fantasy romance.' }], mood: { field: 'description', quote: b.description, interpretation: 'Matches the mood.' } };
    expect(rankPool([b], buildProfile(db), rankContext(db, input), [ai])).toEqual([]);
    expect(rankPool([b], buildProfile(db), rankContext(db, input))).toHaveLength(1);
    expect(recommendationEligible(b, taste, { ...ai, risks: [{ ...ai.risks[0], quote: 'Invented romance evidence' }] })).toBe(true);
  });
  it('allows explicit format requests and does not apply fiction defaults to nonfiction readers', () => {
    const anthology = book({ subjects: ['Science fiction', 'Anthologies'] });
    expect(recommendationEligible(anthology, { preferences: [...preferences, preference('anthologies')] })).toBe(true);
    const stories = book({ subjects: ['Science fiction', 'Short stories'] });
    expect(recommendationEligible(stories, { preferences: [...preferences, preference('short stories')] })).toBe(true);
    const reference = book({ title: 'Encyclopedia of science fiction' });
    expect(recommendationEligible(reference, { preferences: [preference('literary criticism')] })).toBe(true);
    expect(recommendationEligible(reference, { preferences: [...preferences, preference('reference')] })).toBe(true);
  });
  it('does not classify fictional guides or incidental plot objects as reference works', () => {
    for (const b of [book({ title: 'The Hitchhiker’s Guide to the Galaxy' }), book({ description: 'An engineer carries an encyclopedia across the galaxy.' }), book({ subjects: ['Science fiction', 'Long Now Manual for Civilization'] })]) {
      expect(recommendationEligible(b, taste)).toBe(true);
    }
  });
  it('does not infer a genre match from the title or incidental words in a synopsis', () => {
    const db = setup();
    const b = book({ title: 'Science Fiction', subjects: ['Literary fiction'], description: 'A bookseller reads science fiction while waiting for her daughter.' });
    expect(rankPool([b], buildProfile(db), rankContext(db, input))[0].evidence).toEqual([]);
    expect(rankPool([book({ subjects: ['Sci-fi'] })], buildProfile(db), rankContext(db, input))[0].evidence[0].preferenceId).toBe('science fiction');
  });
});

it('keeps exploration within preferred genres and removes the unsolicited short-story search', () => {
  const db = setup(), profile = buildProfile(db), strategies = defaultStrategies(profile, '');
  expect(strategies.some(s => s.query.includes('short stories'))).toBe(false);
  expect(strategies.some(s => s.query.includes('space opera'))).toBe(true);
  expect(strategies.some(s => s.query.includes('epic fantasy'))).toBe(true);
  const scoped = discoveryQuery('author:"A Writer" OR subject:"translated fiction"', profile);
  expect(scoped).toContain('(author:"A Writer" OR subject:"translated fiction") AND (');
  expect(scoped).toContain('subject:"science fiction"');
  expect(scoped).toContain('subject:"fantasy"');
  expect(discoveryQuery('subject:"history"', { preferences: [] })).toBe('subject:"history"');
  expect(discoveryQuery('subject:"memory"', { preferences: [preference('cyberpunk')] })).toBe('(subject:"memory") AND (subject:"cyberpunk")');
});

it('checks search results, enriched descriptions and replacement starters without padding the batch', async () => {
  const db = setup(), profile = buildProfile(db);
  vi.stubEnv('MODEL_NAME', '');
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network request'); }));
  const cache = (key: string, value: unknown) => db.prepare('INSERT INTO recommendation_cache VALUES(?,?,?)').run(key, JSON.stringify(value), '2099-01-01');
  const docs = [
    { key: '/works/OL1W', title: 'A Distant Signal', subject: ['Science fiction'] },
    { key: '/works/OL2W', title: 'The mammoth encyclopedia of science fiction', subject: ['Science fiction'] },
    { key: '/works/OL3W', title: 'The Big Book of Science Fiction', subject: ['Science fiction'] },
    { key: '/works/OL4W', title: 'A Fantasy Romance', subject: ['Fantasy romance'] },
    { key: '/works/OL5W', title: 'Unrelated', subject: ['Cooking'] },
    { key: '/works/OL6W', title: 'A Sequel', subject: ['Fantasy'], series_key: ['OL1L'], series_name: ['Test Series'], series_position: ['2'] },
  ].map((d, i) => ({ ...d, author_name: [`Writer ${i}`], language: ['eng'] }));
  const cacheSearch = (query: string, docs: unknown[]) => {
    const params = new URLSearchParams({ q: query, fields: CATALOG_FIELDS, limit: '40', page: '1' });
    cache(`catalog-v3:${hash(params.toString())}`, { docs, numFound: docs.length });
  };
  for (const s of defaultStrategies(profile, '')) cacheSearch(languageQuery(discoveryQuery(s.query, profile), ['en']), docs);
  for (const d of docs.filter(d => !['/works/OL2W', '/works/OL4W'].includes(d.key))) cache(`work-v2:${d.key}`, { key: d.key, title: d.title, subjects: d.subject, description: d.key === '/works/OL3W' ? 'An anthology of science fiction stories.' : 'An engineer crosses a galaxy.' });
  const starter = { key: '/works/OL7W', title: 'The Beginning', author_name: ['Starter Writer'], language: ['eng'], subject: ['Fantasy'], series_key: ['OL1L'], series_name: ['Test Series'], series_position: ['1'] };
  cacheSearch('series_key:OL1L', [starter]);
  cache('work-v2:/works/OL7W', { key: starter.key, title: starter.title, subjects: ['Fantasy romance'], description: 'A fantasy romance novel.' });
  const id = queueBatch(db, input); await generateBatch(db, id);
  expect(batchState(db).last.items.map((b: { title: string }) => b.title)).toEqual(['A Distant Signal']);
  expect(db.prepare('SELECT * FROM recommendation_exposures').all()).toHaveLength(1);
  expect(fetch).not.toHaveBeenCalled();
});

it('filters older saved batches against current preferences without modifying stored results', () => {
  const db = setup(), profile = buildProfile(db);
  const originals = [book(), book({ key: '/works/OL2W', title: 'The Wesleyan anthology of science fiction' }), book({ key: '/works/OL3W', title: 'Love and Magic', subjects: ['Fantasy romance'] })];
  const items = rankPool(originals, { ...profile, preferences: [] }, rankContext(db, input));
  const stored = JSON.stringify({ items, profile });
  const id = queueBatch(db, input);
  db.prepare("UPDATE recommendation_batches SET status='complete',completed_at='now',result_json=? WHERE id=?").run(stored, id);
  expect(batchState(db).last.items.map((b: { title: string }) => b.title)).toEqual(['A Distant Signal']);
  expect(db.prepare('SELECT result_json FROM recommendation_batches WHERE id=?').get(id)).toEqual({ result_json: stored });
});
