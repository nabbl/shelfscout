import { normalize } from '../identity';
import type { Candidate } from '../recommendations';
import type { Preference, Profile } from './types';

export type FitEvidence = {
  preferenceId: string;
  preference: string;
  catalogQuote: string;
  field?: 'author' | 'subjects' | 'description';
  kind?: 'match' | 'risk';
};
type FitBook = {
  category?: string;
  author: string;
  description?: string;
  subjects?: string[];
  evidence?: FitEvidence[];
  moodMatched?: boolean;
};
type FitProfile = Pick<Profile, 'preferences' | 'evidence'>;
// A genre remains broad even when it was entered under Theme or another dimension.
const broadGenre = /\b(fantasy|science fiction|sci fi|scifi|fiction|nonfiction|non fiction|romance|horror|thriller|thrillers|mystery|mysteries|literature|literary|classics|poetry|young adult|biography|memoir|historical|adventure)\b/;
export const isBroadGenre = (value: string) => broadGenre.test(normalize(value));

function supportedPreference(preference: Preference, profile: FitProfile): boolean {
  if (preference.confidence !== 'supported' || preference.counterexamples.length) return false;
  if (preference.origin === 'explicit') return true;
  const supportingWorks = new Set(profile.evidence.filter(e => preference.support.includes(e.id) && (e.rating ?? 0) >= 4).map(e => e.workKey));
  return supportingWorks.size >= 2;
}

/** Evidence categories describe support, never a probability of enjoying a book. */
export function fitCategory(book: FitBook, profile?: FitProfile, mood = ''): { category: Candidate['category']; categoryReason: string } {
  const signals = (book.evidence || []).flatMap(evidence => {
    const quote = evidence.catalogQuote?.trim();
    if (!quote) return [];
    const field = evidence.field || (book.subjects?.some(subject => subject.includes(quote)) ? 'subjects' : book.description?.includes(quote) ? 'description' : book.author.includes(quote) ? 'author' : undefined);
    const source = field === 'description' ? book.description : field === 'author' ? book.author : field === 'subjects' ? book.subjects?.join('; ') : undefined;
    if (!source?.includes(quote)) return [];
    const preference = profile?.preferences.find(p => p.id === evidence.preferenceId);
    const risk = evidence.kind === 'risk' || preference?.direction === 'avoid' || (!preference && evidence.preference.startsWith('avoid '));
    if (!preference && !/^(prefer|avoid) /i.test(evidence.preference)) return [];
    return [{ preference, descriptionSupported: Boolean(book.description?.includes(quote)), risk }];
  });
  const positive = signals.filter(signal => !signal.risk);
  // Older batches did not record which AI evidence was a risk. Preserve their conflict label.
  const conflict = signals.some(signal => signal.risk) || book.category === 'wildcard';
  if (positive.length && conflict) return { category: 'wildcard', categoryReason: 'Matches some interests, with a recorded preference conflict. Check the caveat before choosing.' };
  if (!positive.length) return { category: 'discovery', categoryReason: 'There is not enough preference evidence to establish a personal fit.' };

  const specific = positive.flatMap(signal => {
    const preference = signal.preference;
    if (!profile || !preference || !signal.descriptionSupported || ['subject', 'author'].includes(preference.dimension) || isBroadGenre(preference.value) || !supportedPreference(preference, profile)) return [];
    return [preference];
  });
  const conflictingHistory = positive.some(signal => signal.preference?.confidence === 'conflicting' || Boolean(signal.preference?.counterexamples.length));
  const dimensions = new Set(specific.map(preference => preference.dimension));
  const values = new Set(specific.map(preference => normalize(preference.value)));
  if (!conflict && !conflictingHistory && dimensions.size >= 2 && values.size >= 2 && (!mood || book.moodMatched === true)) {
    return { category: 'strong fit', categoryReason: 'The description matches at least two specific preferences across different aspects of the book, backed by your choices or reading history.' };
  }
  return { category: 'matches your interests', categoryReason: mood && book.moodMatched !== true
    ? 'Your interests overlap with the catalog evidence, but a match to your current mood is not established.'
    : 'The catalog matches some of your interests. More specific evidence is needed to call this a strong fit.' };
}

export function withFitCategory<T extends FitBook>(book: T, profile?: FitProfile, mood = '') {
  return { ...book, ...fitCategory(book, profile, mood) };
}
