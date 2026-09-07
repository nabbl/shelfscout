import { normalize } from './identity';
import type { BookCandidate } from './bookorbit';
import type { Release } from './shelfmark';

const languageAliases: Record<string, string> = { eng: 'en', english: 'en', deu: 'de', ger: 'de', german: 'de', deutsch: 'de', fra: 'fr', fre: 'fr', french: 'fr', spa: 'es', spanish: 'es', ita: 'it', italian: 'it', por: 'pt', nld: 'nl', dut: 'nl', jpn: 'ja', zho: 'zh', chi: 'zh', rus: 'ru' };
export const languageCode = (value: unknown) => { const n = normalize(typeof value === 'string' ? value : ''); return languageAliases[n] || n; };
export function metadataMatches(candidate: BookCandidate, metadata: Record<string, unknown> | null | undefined) {
  if (!metadata || !candidate.author || !candidate.language || candidate.language === 'und') return false;
  const authors = Array.isArray(metadata.authors) ? metadata.authors.map(a => normalize(typeof a === 'string' ? a : String(a?.name || ''))) : [];
  return normalize(String(metadata.title || '')) === normalize(candidate.title)
    && authors.includes(normalize(candidate.author))
    && languageCode(metadata.language) === languageCode(candidate.language)
    && (!candidate.isbn13 || metadata.isbn13 === candidate.isbn13);
}
export function releaseAssessment(c: BookCandidate, r: Release): { selectable: boolean; exact: boolean; reason: string } {
  const extra = r.extra || {};
  const author = typeof extra.author === 'string' ? extra.author : '';
  const isbn = typeof extra.isbn13 === 'string' ? extra.isbn13 : typeof extra.isbn === 'string' ? extra.isbn : '';
  const compatible = normalize(r.title) === normalize(c.title) && languageCode(r.language) === languageCode(c.language)
    && normalize(r.format) === 'epub' && (!r.content_type || r.content_type === 'ebook')
    && !extra.multi_book && !extra.book_plan && (!author || normalize(author) === normalize(c.author))
    && (!c.isbn13 || !isbn || isbn === c.isbn13);
  const exact = compatible && !!c.isbn13 && isbn === c.isbn13 && !!author && normalize(author) === normalize(c.author);
  return { selectable: compatible, exact, reason: !compatible ? 'Title, author, language, edition, or EPUB format does not match.' : exact ? 'Title, author, ISBN, language and EPUB match.' : 'Edition or author evidence is incomplete. Confirm this release explicitly; embedded metadata will still be checked before import.' };
}
