import { normalize } from '../identity';
import { hash } from './profile';
import type { Profile } from './types';

export type MoodSuggestion = { id: string; label: string; query: string; reason: string; books: string[] };
const choices = [
  { id: 'reflective', label: 'Thoughtful & reflective', terms: ['memory', 'identity', 'philosophy', 'self discovery', 'coming of age'] },
  { id: 'mysterious', label: 'A mystery to unravel', terms: ['mystery', 'mysteries', 'detective', 'suspense'] },
  { id: 'adventurous', label: 'An adventure', terms: ['adventure', 'exploration', 'quests', 'journeys'] },
  { id: 'speculative', label: 'Big what-if ideas', terms: ['science fiction', 'speculative fiction', 'dystopia', 'time travel', 'robots'] },
  { id: 'fantastical', label: 'Something fantastical', terms: ['fantasy', 'magic', 'mythology', 'dragons'] },
  { id: 'strange', label: 'Something strange', terms: ['surrealism', 'weird fiction', 'magical realism', 'absurdism'] },
  { id: 'warm', label: 'Warm & human', terms: ['friendship', 'family', 'love', 'relationships'] },
  { id: 'dark', label: 'Dark & unsettling', terms: ['horror', 'gothic', 'psychological fiction'] },
  { id: 'playful', label: 'Playful & funny', terms: ['humor', 'humour', 'satire', 'comedy'] },
  { id: 'historical', label: 'Another time', terms: ['historical fiction', 'history'] },
] as const;
const contains = (text: string, term: string) => ` ${normalize(text)} `.includes(` ${normalize(term)} `);

/** Deterministic suggestions cite actual history/preferences, never invented mood traits. */
export function moodSuggestions(profile: Profile, previous?: Profile | null): MoodSuggestion[] {
  const hidden = new Set(profile.settings.hiddenMoods);
  const negative = profile.preferences.filter(p => p.direction === 'avoid');
  const history = profile.evidence.filter(e => (e.rating != null ? e.rating >= 4 : e.status === 'read')).map(e => {
    const cached = previous?.evidence?.find(old => old.workKey === e.workKey && normalize(old.title) === normalize(e.title) && normalize(old.author) === normalize(e.author));
    return { ...e, terms: [...e.shelves, ...(e.catalog?.subjects || cached?.catalog?.subjects || [])] };
  });
  const derived = (previous?.preferences || []).filter(p => p.origin !== 'explicit' && p.support.length > 0 && !p.counterexamples.length && !profile.settings.disabled.includes(p.id)
    && !profile.preferences.some(current => normalize(current.value) === normalize(p.value))
    && p.support.every(id => history.some(e => e.id === id && e.rating != null && e.rating >= 4 && previous?.evidence?.some(old => old.id === id && old.workKey === e.workKey))));
  const positive = [...profile.preferences, ...derived].filter(p => p.direction === 'prefer' && p.dimension !== 'author');
  const result: MoodSuggestion[] = [];
  for (const choice of choices) {
    if (hidden.has(choice.id)) continue;
    const matched = choice.terms.filter(term => !negative.some(p => contains(p.value, term)) && (history.some(e => e.terms.some(value => contains(value, term))) || positive.some(p => contains(p.value, term))));
    if (!matched.length) continue;
    const query = matched[0];
    const books = [...new Set(history.filter(e => e.terms.some(value => contains(value, query)) || positive.some(p => p.support.includes(e.id) && contains(p.value, query))).map(e => e.title))].slice(0, 3);
    result.push({ id: choice.id, label: choice.label, query, books, reason: books.length ? `From themes in ${books.join(', ')}.` : `From your preference for ${positive.find(p => contains(p.value, query))!.value}.` });
  }
  for (const preference of positive) {
    const id = `preference:${hash(normalize(preference.value)).slice(0, 16)}`;
    if (hidden.has(id) || choices.some(choice => choice.terms.some(term => contains(preference.value, term))) || result.some(option => contains(preference.value, option.query))) continue;
    const books = history.filter(e => preference.support.includes(e.id)).map(e => e.title).slice(0, 3);
    result.push({ id, label: preference.value, query: preference.value, books, reason: books.length ? `Suggested by your reading of ${books.join(', ')}.` : `From your saved ${preference.dimension} preference.` });
  }
  return result.slice(0, 8);
}
