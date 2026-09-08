import { afterEach, expect, it } from 'vitest';
import { createDatabase } from '../src/lib/db';
import { fitCategory } from '../src/lib/recommendation/fit';
import { rankPool } from '../src/lib/recommendation/rank';
import { batchState, queueBatch, rankContext } from '../src/lib/recommendation/engine';
import { buildProfile } from '../src/lib/recommendation/profile';
import type { CatalogBook, Preference, Profile } from '../src/lib/recommendation/types';

const dbs: ReturnType<typeof createDatabase>[] = [];
afterEach(() => dbs.splice(0).forEach(db => db.close()));
const input = { mood: '', mode: 'refresh' as const, rereads: false };
function setup() { const db = createDatabase(':memory:'); dbs.push(db); return { db, profile: buildProfile(db), context: rankContext(db, input) }; }
const preference = (id: string, dimension: Preference['dimension'], value: string, changes: Partial<Preference> = {}): Preference => ({ id, dimension, value, direction: 'prefer', origin: 'explicit', confidence: 'supported', support: ['owner'], counterexamples: [], ...changes });
const pacing = () => preference('pace', 'pacing', 'slow paced');
const structure = () => preference('structure', 'structure', 'unreliable narrator');
const book = (changes: Partial<CatalogBook> = {}): CatalogBook => ({ key: '/works/OL1W', title: 'A Book', author: 'A Writer', year: 2020, language: 'eng', isbns: [], coverUrl: null, series: null, subjects: ['fiction'], description: 'A slow paced story with an unreliable narrator.', strategies: ['fixture'], ...changes });

it('labels broad fantasy/science fiction overlap as interests and limits its ranking weight', () => {
  const { profile, context } = setup();
  profile.preferences = [preference('fantasy', 'theme', 'fantasy'), preference('scifi', 'subject', 'science fiction')];
  const ranked = rankPool([book({ subjects: ['fantasy', 'science fiction'], description: 'A fantasy and science fiction story.' })], profile, context)[0];
  expect(ranked).toMatchObject({ category: 'matches your interests', score: 2, batchReason: '' });
  expect(ranked.categoryReason).toContain('More specific evidence');
});
it('uses Strong fit for distinct, explicit specifics grounded in the description', () => {
  const { profile, context } = setup(); profile.preferences = [pacing(), structure()];
  const ranked = rankPool([book()], profile, context)[0];
  expect(ranked).toMatchObject({ category: 'strong fit', score: 8 });
  expect(ranked.evidence.map(e => e.field)).toEqual(['description', 'description']);
  expect(fitCategory(ranked, profile).category).toBe('strong fit');
  // A subject tag that also appears in the description still has description support.
  expect(rankPool([book({ subjects: ['slow paced', 'unreliable narrator'] })], profile, context)[0].category).toBe('strong fit');
});
it.each([
  ['one specific preference', [pacing()]],
  ['the same value repeated across dimensions', [pacing(), preference('duplicate', 'structure', 'slow paced')]],
  ['two matches in the same dimension', [pacing(), preference('duplicate', 'pacing', 'unreliable narrator')]],
  ['a tentative inference', [pacing(), structure()].map(p => ({ ...p, origin: 'model' as const, confidence: 'tentative' as const }))],
  ['a genre entered as prose', [pacing(), preference('genre', 'prose', 'fantasy')]],
  ['an author match', [pacing(), preference('author', 'author', 'A Writer')]],
] as const)('does not inflate %s into Strong fit', (_, preferences) => {
  const { profile, context } = setup(); profile.preferences = [...preferences];
  expect(rankPool([book({ description: `${book().description} A fantasy by A Writer.` })], profile, context)[0].category).toBe('matches your interests');
});
it('withholds Strong fit for subject-only matches, conflicting history, or an unestablished current mood', () => {
  const { profile, context } = setup(); profile.preferences = [pacing(), structure()];
  expect(rankPool([book({ description: '', subjects: ['slow paced', 'unreliable narrator'] })], profile, context)[0].category).toBe('matches your interests');
  expect(rankPool([book()], profile, { ...context, mood: 'adventure' })[0].category).toBe('matches your interests');
  profile.preferences.push(preference('history-conflict', 'theme', 'story', { confidence: 'conflicting', counterexamples: ['reading:3'] }));
  expect(rankPool([book()], profile, context)[0].category).toBe('matches your interests');
});
it('requires independent positive history support for inferred specifics', () => {
  const { profile, context } = setup();
  profile.preferences = [pacing(), { ...structure(), origin: 'inferred', support: ['reading:1', 'reading:2'] }];
  const evidence = (id: string, workKey: string, rating: number): Profile['evidence'][number] => ({ id, workKey, rating, title: 'History', author: 'Writer', status: 'read', shelves: [], date: null });
  profile.evidence = [evidence('reading:1', 'first', 5), evidence('reading:2', 'second', 4)];
  expect(rankPool([book()], profile, context)[0].category).toBe('strong fit');
  profile.evidence[1].workKey = 'first';
  expect(rankPool([book()], profile, context)[0].category).toBe('matches your interests');
  profile.evidence[1].workKey = 'second'; profile.evidence[1].rating = 2;
  expect(rankPool([book()], profile, context)[0].category).toBe('matches your interests');
  profile.evidence[1].rating = 5; profile.preferences[1].counterexamples = ['reading:3'];
  expect(rankPool([book()], profile, context)[0].category).toBe('matches your interests');
});
it('keeps explicit and AI preference conflicts as Wildcard, and no matches as Discovery', () => {
  const { profile, context } = setup(); profile.preferences = [pacing(), { ...structure(), direction: 'avoid' }];
  expect(rankPool([book()], profile, context)[0].category).toBe('wildcard');
  profile.preferences = [pacing(), structure()];
  const ranked = rankPool([book()], profile, context, [{ key: book().key, matches: [], risks: [{ preferenceId: 'structure', quote: 'unreliable narrator', field: 'description', interpretation: 'A possible tension.' }], mood: null }])[0];
  expect(ranked.category).toBe('wildcard');
  expect(ranked.evidence.find(e => e.preferenceId === 'structure')?.kind).toBe('risk');
  expect(fitCategory(ranked, profile).category).toBe('wildcard');
  // Legacy evidence still retains the known conflict even without per-signal risk fields.
  const legacy = { ...ranked, evidence: ranked.evidence.map(e => ({ ...e, kind: undefined, field: undefined })) };
  expect(fitCategory(legacy, profile).category).toBe('wildcard');
  expect(rankPool([book({ description: 'An unrelated story.' })], profile, context)[0].category).toBe('discovery');
});
it('does not treat quotes absent from their claimed catalog field as evidence', () => {
  const { profile } = setup(); profile.preferences = [pacing(), structure()];
  const result = fitCategory({ ...book(), evidence: profile.preferences.map(p => ({ preferenceId: p.id, preference: `prefer ${p.value}`, catalogQuote: p.value, field: 'subjects', kind: 'match' })) }, profile);
  expect(result.category).toBe('discovery');
});
it('relabels old cached batches without regenerating, reordering, or overwriting stored results', () => {
  const { db, profile, context } = setup();
  profile.preferences = [preference('genre', 'theme', 'fantasy')];
  const ranked = rankPool([book({ subjects: ['fantasy'] })], profile, context)[0];
  const legacy = { ...ranked, category: 'strong fit', evidence: ranked.evidence.map(e => ({ ...e, kind: undefined, field: undefined })) };
  const id = queueBatch(db, input);
  const stored = JSON.stringify({ items: [legacy], profile, mood: '' });
  db.prepare("UPDATE recommendation_batches SET status='complete',result_json=?,completed_at='now' WHERE id=?").run(stored, id);
  const displayed = batchState(db).last;
  expect(displayed.id).toBe(id);
  expect(displayed.items[0]).toMatchObject({ category: 'matches your interests', catalogKey: ranked.catalogKey, score: ranked.score, why: ranked.why });
  expect(db.prepare('SELECT result_json FROM recommendation_batches WHERE id=?').get(id)).toEqual({ result_json: stored });
});
