import { normalize } from './identity';
import type { BookCandidate } from './bookorbit';
import type { Release } from './shelfmark';

import { languageCode } from './languages';
export { languageCode } from './languages';

// Semicolons/explicit conjunctions separate credits; a comma within a credit
// denotes "surname, given names". Never match by surname or substring alone.
function authorNames(value: string): string[] {
  return [...new Set(value.split(/;|\s+&\s+|\s+and\s+/i).map(credit => {
    const parts = credit.split(',').map(part => part.trim());
    return normalize(parts.length === 2 && parts.every(Boolean) ? `${parts[1]} ${parts[0]}` : credit);
  }).filter(Boolean))];
}
function authorMatch(expected: string | null | undefined, actual: string[]) {
  const wanted = authorNames(expected || '');
  const found = [...new Set(actual.flatMap(authorNames))];
  const matches = wanted.length > 0 && wanted.every(name => found.includes(name));
  return { matches, sameCredits: matches && wanted.length === found.length };
}
export function metadataMatches(candidate: BookCandidate, metadata: Record<string, unknown> | null | undefined) {
  if (!metadata || !candidate.author || !candidate.language || candidate.language === 'und') return false;
  const authors = Array.isArray(metadata.authors) ? metadata.authors.map(a => typeof a === 'string' ? a : String(a?.name || '')) : [];
  return normalize(String(metadata.title || '')) === normalize(candidate.title)
    && authorMatch(candidate.author, authors).matches
    && languageCode(metadata.language) === languageCode(candidate.language)
    && (!candidate.isbn13 || metadata.isbn13 === candidate.isbn13);
}
export function releaseAssessment(c: BookCandidate, r: Release): { selectable: boolean; exact: boolean; reason: string } {
  const extra = r.extra || {};
  const author = typeof extra.author === 'string' ? extra.author : '';
  const isbn = typeof extra.isbn13 === 'string' ? extra.isbn13 : typeof extra.isbn === 'string' ? extra.isbn : '';
  const authors = authorMatch(c.author, [author]);
  // Shelfmark direct_download preserves source labels such as "📕 book (fiction)".
  const ebookContent = !r.content_type || ['ebook', 'book', 'books', 'book fiction', 'book nonfiction', 'book non fiction', 'book unknown'].includes(normalize(r.content_type));
  const mismatch = normalize(r.title) !== normalize(c.title) ? 'Title does not match.'
    : languageCode(r.language) !== languageCode(c.language) ? 'Language does not match.'
    : normalize(r.format) !== 'epub' || !ebookContent ? 'Release is not an EPUB ebook.'
    : extra.multi_book || extra.book_plan ? 'Release contains multiple books or a book plan.'
    : author && !authors.matches ? 'Author credits do not include the requested author(s).'
    : c.isbn13 && isbn && isbn !== c.isbn13 ? 'ISBN does not match the requested edition.' : '';
  const compatible = !mismatch;
  const exact = compatible && !!c.isbn13 && isbn === c.isbn13 && authors.sameCredits;
  return { selectable: compatible, exact, reason: mismatch || (exact ? 'Title, author, ISBN, language and EPUB match.' : authors.matches && !authors.sameCredits ? 'The requested author is credited alongside additional authors. Confirm this version explicitly; embedded metadata will still be checked before import.' : 'Edition or author evidence is incomplete. Confirm this release explicitly; embedded metadata will still be checked before import.') };
}
