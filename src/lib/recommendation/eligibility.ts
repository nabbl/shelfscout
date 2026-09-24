import { normalize } from '../identity';
import type { Assessment, CatalogBook, Preference, Profile } from './types';

type BookEvidence = Pick<CatalogBook, 'title' | 'subjects' | 'description'>;
type Taste = Pick<Profile, 'preferences'>;

// Deliberately limited to recognizable genres: avoiding a theme or a pacing trait
// remains a tradeoff, while an explicit genre exclusion is an eligibility rule.
const genres: Record<string, string[]> = {
  'science fiction': ['science fiction', 'sci fi', 'scifi', 'space opera', 'cyberpunk'],
  'space opera': ['space opera'],
  cyberpunk: ['cyberpunk'],
  fantasy: ['fantasy', 'fantastic fiction'],
  romantasy: ['romantasy', 'romantic fantasy', 'fantasy romance'],
  romance: ['romance', 'romantic fiction'],
  horror: ['horror'],
  mystery: ['mystery', 'mysteries', 'detective fiction'],
  thriller: ['thriller', 'thrillers'],
};
export function genreTerms(value: string): string[] | undefined {
  const key = normalize(value);
  return Object.hasOwn(genres, key) ? genres[key] : Object.values(genres).find(terms => terms.includes(key));
}
export function preferredGenres(profile: Taste): Preference[] {
  return profile.preferences.filter(p => p.origin === 'explicit' && p.direction === 'prefer' && genreTerms(p.value));
}
const contains = (text: string, term: string) => ` ${normalize(text)} `.includes(` ${term} `);
export function genreQuote(book: Pick<BookEvidence, 'subjects' | 'description'>, value: string): string | undefined {
  const terms = genreTerms(value);
  if (!terms) return undefined;
  // Subject classifications are stronger than an incidental word in a synopsis.
  const subject = book.subjects.find(s => terms.some(term => contains(s, term)));
  if (subject) return subject;
  // Description-only classification must actually label the work's genre.
  return terms.some(term => new RegExp(`\\b${term} (?:novel|story|adventure|tale|thriller|epic)\\b`).test(normalize(book.description))) ? book.description : undefined;
}

function format(book: BookEvidence): 'reference' | 'anthology' | 'stories' | null {
  const title = normalize(book.title), subjects = book.subjects.map(normalize), description = normalize(book.description);
  if (/\b(?:encyclop[a]?edia|dictionary|handbook|bibliography) of\b|\b(?:study|reference) guide\b/.test(title)
    || subjects.some(s => /\b(?:encyclop[a]?edias|dictionaries|bibliography|bibliographies|history and criticism|literary criticism|study guides|handbooks manuals)\b/.test(s))
    || /^(?:this (?:book|volume|work) is an?|an?|the) (?:illustrated |comprehensive )?(?:encyclop[a]?edia|reference work|reference guide|study guide|textbook)\b/.test(description)) return 'reference';
  if (/\bantholog(?:y|ies)\b/.test(title)
    || subjects.some(s => /\bantholog(?:y|ies)\b/.test(s))
    || /\b(?:an?|this|the) (?:\w+ ){0,3}anthology\b|\b(?:stories|fiction) by (?:\w+ ){0,2}(?:writers|authors)\b/.test(description)) return 'anthology';
  if (subjects.some(s => /\bshort stories\b/.test(s))
    || /\b(?:collected|selected|complete) (?:short )?stories\b/.test(title)
    || /\bcollection of (?:\w+ ){0,4}(?:stories|short fiction)\b/.test(description)) return 'stories';
  return null;
}

/** Genre preferences mean stories in that genre, not books about that genre. */
export function recommendationEligible(book: BookEvidence, profile: Taste, assessment?: Assessment): boolean {
  const preferred = profile.preferences.filter(p => p.origin === 'explicit' && p.direction === 'prefer');
  const kind = format(book);
  if (preferredGenres(profile).length && kind) {
    const optedIn = preferred.some(p => kind === 'reference'
      ? /\b(?:reference|encyclopedia|encyclopaedia|literary criticism|nonfiction|non fiction)\b/.test(normalize(p.value))
      : kind === 'anthology' ? /\bantholog(?:y|ies)\b/.test(normalize(p.value))
      : /\b(?:short stories|short fiction|story collections)\b/.test(normalize(p.value)));
    if (!optedIn) return false;
  }
  return !profile.preferences.some(p => {
    if (p.origin !== 'explicit' || p.direction !== 'avoid' || !genreTerms(p.value)) return false;
    if (genreQuote(book, p.value)) return true;
    // Separate fantasy + romance classifications indicate a genre crossover;
    // a love interest in a fantasy synopsis alone does not establish romantasy.
    if (genreTerms(p.value) === genres.romantasy && genreQuote({ ...book, description: '' }, 'fantasy') && genreQuote({ ...book, description: '' }, 'romance')) return true;
    return assessment?.risks.some(r => r.preferenceId === p.id && (r.field === 'subjects' ? book.subjects.join('; ') : book.description).includes(r.quote));
  });
}

/** Scope every discovery strategy, including model queries and exploration. */
export function discoveryQuery(query: string, profile: Taste): string {
  const preferred = preferredGenres(profile);
  if (!preferred.length) return query;
  const scope = [...new Set(preferred.flatMap(p => genreTerms(p.value)!))].map(term => `subject:${JSON.stringify(term)}`).join(' OR ');
  return `(${query}) AND (${scope})`;
}
