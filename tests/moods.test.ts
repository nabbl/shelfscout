import { expect, it } from 'vitest';
import { moodSuggestions } from '../src/lib/recommendation/moods';
import { settingsSchema, type Profile } from '../src/lib/recommendation/types';

const profile = (): Profile => ({ version: 'fixture', settings: settingsSchema.parse({}), evidence: [{ id: 'reading:1', workKey: 'one', title: 'Remembered City', author: 'Writer', rating: 5, status: 'read', shelves: ['memory', 'science-fiction'], date: null }], preferences: [], unknown: [] });
it('suggests coherent moods with named supporting books', () => {
  expect(moodSuggestions(profile())).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'reflective', query: 'memory', books: ['Remembered City'] }), expect.objectContaining({ id: 'speculative', query: 'science fiction' })]));
});
it('does not turn disliked books, to-read books or generic shelves into suggestions', () => {
  const p = profile(); p.evidence[0].rating = 1; expect(moodSuggestions(p)).toEqual([]);
  p.evidence[0].rating = null; p.evidence[0].status = 'to-read'; expect(moodSuggestions(p)).toEqual([]);
  p.evidence[0].status = 'read'; p.evidence[0].shelves = ['read', 'to-read']; expect(moodSuggestions(p)).toEqual([]);
});
it('uses verified cached catalog subjects only for matching current history identities', () => {
  const p = profile(), previous = profile(); p.evidence[0].shelves = [];
  previous.evidence[0].catalog = { key: '/works/OL1W', description: '', subjects: ['mystery'], sourceUrl: 'https://openlibrary.org/works/OL1W' };
  expect(moodSuggestions(p, previous)[0]?.id).toBe('mysterious');
  previous.evidence[0].title = 'Different book'; expect(moodSuggestions(p, previous)).toEqual([]);
});
it('honors hidden choices and explicit negative preferences', () => {
  const p = profile(); p.settings.hiddenMoods = ['reflective']; expect(moodSuggestions(p).map(m => m.id)).not.toContain('reflective');
  p.preferences = [{ id: 'avoid-sf', dimension: 'subject', direction: 'avoid', value: 'science fiction', origin: 'explicit', confidence: 'supported', support: [], counterexamples: [] }];
  expect(moodSuggestions(p)).toEqual([]);
});
it('labels preference-based suggestions honestly when reading evidence is absent', () => {
  const p = profile(); p.evidence = []; p.preferences = [{ id: 'owner', dimension: 'theme', direction: 'prefer', value: 'unreliable narrators', origin: 'explicit', confidence: 'supported', support: ['owner'], counterexamples: [] }];
  expect(moodSuggestions(p)[0]).toMatchObject({ label: 'unreliable narrators', query: 'unreliable narrators', books: [], reason: 'From your saved theme preference.' });
});
it('defaults existing settings to allow series without losing existing preferences', () => {
  expect(settingsSchema.parse({ includeReviews: true })).toMatchObject({ allowSeries: true, hiddenMoods: [], includeReviews: true });
});
it('retains grounded inferred suggestions only while their supporting history is positive', () => {
  const p = profile(), previous = profile(); p.evidence[0].shelves = [];
  previous.preferences = [{ id: 'model:memory', dimension: 'theme', value: 'memory', direction: 'prefer', origin: 'model', confidence: 'tentative', support: ['reading:1'], counterexamples: [] }];
  expect(moodSuggestions(p, previous)[0]).toMatchObject({ id: 'reflective', books: ['Remembered City'] });
  p.settings.hiddenMoods = ['reflective']; expect(moodSuggestions(p, previous)).toEqual([]);
  p.settings.hiddenMoods = []; p.evidence[0].rating = 1; expect(moodSuggestions(p, previous)).toEqual([]);
});
