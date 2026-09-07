import { describe, expect, it } from 'vitest';
import { languageCode, metadataMatches, releaseAssessment } from '../src/lib/acquisition-identity';

const book = { title: 'Nightfall', author: 'Isaac Asimov', language: 'en', isbn13: null };
const release = { title: 'Nightfall', source: 'direct_download', source_id: 'fixture', language: 'en', format: 'epub', content_type: '📕 book (fiction)', extra: { author: 'Asimov, Isaac; Silverberg, Robert' } };

describe('acquisition author credits', () => {
  it.each(['en-US', 'en-GB', 'en_US', 'eng-US'])('recognizes %s as English in release, embedded and library metadata', language => {
    expect(languageCode(language)).toBe('en');
    expect(metadataMatches(book, { title: book.title, authors: ['Isaac Asimov'], language })).toBe(true);
    expect(releaseAssessment(book, { ...release, language }).selectable).toBe(true);
  });
  it('normalizes regional and script tags without matching different or unknown languages', () => {
    expect(languageCode('pt_BR')).toBe('pt');
    expect(languageCode('zh-Hant-TW')).toBe('zh');
    for (const language of ['de-DE', 'fr-CA', 'und', null, '']) expect(metadataMatches(book, { title: book.title, authors: ['Isaac Asimov'], language })).toBe(false);
  });
  it('allows surname-first co-author credits for explicit selection', () => {
    expect(releaseAssessment(book, release)).toMatchObject({ selectable: true, exact: false, reason: expect.stringContaining('additional authors') });
    // Additional credits still need confirmation even with matching ISBN evidence.
    expect(releaseAssessment({ ...book, isbn13: '9780306406157' }, { ...release, extra: { ...release.extra, isbn13: '9780306406157' } })).toMatchObject({ selectable: true, exact: false });
  });
  it('treats a reordered single credit as exact when ISBN evidence matches', () => {
    expect(releaseAssessment({ ...book, isbn13: '9780306406157' }, { ...release, extra: { author: 'Asimov, Isaac', isbn13: '9780306406157' } })).toMatchObject({ selectable: true, exact: true });
  });
  it.each(['Robert Silverberg', 'Asimov, Janet', 'Isaac', 'Asimov', 'Isaac Asimovson'])('does not confuse %s with the requested author', author => {
    expect(releaseAssessment(book, { ...release, extra: { author } })).toMatchObject({ selectable: false, reason: expect.stringContaining('Author credits') });
    expect(metadataMatches(book, { title: book.title, language: 'en', authors: [author] })).toBe(false);
  });
  it('requires all requested authors while allowing explicit credit separators', () => {
    const coauthored = { ...book, author: 'Isaac Asimov & Robert Silverberg' };
    expect(releaseAssessment(coauthored, release).selectable).toBe(true);
    expect(releaseAssessment(coauthored, { ...release, extra: { author: 'Isaac Asimov' } }).selectable).toBe(false);
  });
  it('uses the same author rules for embedded, selected and library metadata', () => {
    for (const authors of [['Asimov, Isaac; Silverberg, Robert'], [{ name: 'Asimov, Isaac' }, { name: 'Silverberg, Robert' }], ['Isaac Asimov and Robert Silverberg']]) {
      expect(metadataMatches(book, { title: book.title, language: 'eng', authors })).toBe(true);
    }
    expect(metadataMatches(book, { title: book.title, language: 'en', authors: [] })).toBe(false);
  });
  it('still rejects conflicting title, language, format and ISBN', () => {
    for (const changes of [{ title: 'Another Nightfall' }, { language: 'de' }, { format: 'pdf' }]) expect(releaseAssessment(book, { ...release, ...changes }).selectable).toBe(false);
    const edition = { ...book, isbn13: '9780306406157' };
    expect(releaseAssessment(edition, { ...release, extra: { ...release.extra, isbn13: '9780000000002' } }).selectable).toBe(false);
    expect(metadataMatches(edition, { title: book.title, language: 'en', authors: [release.extra.author] })).toBe(false);
  });
  it('recognizes book category labels without allowing audiobooks, magazines or packs', () => {
    for (const content_type of ['ebook', 'book', '📕 book (fiction)', '📗 book (unknown)', 'book (non-fiction)']) expect(releaseAssessment(book, { ...release, content_type }).selectable).toBe(true);
    for (const content_type of ['audiobook', 'magazine', 'book pack']) expect(releaseAssessment(book, { ...release, content_type }).selectable).toBe(false);
    expect(releaseAssessment(book, { ...release, extra: { ...release.extra, multi_book: true } }).selectable).toBe(false);
  });
});
