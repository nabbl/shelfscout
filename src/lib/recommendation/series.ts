import type { ShelfDb } from '../db';
import { normalize } from '../identity';
import { enrichBook, searchCatalogPage } from './catalog';
import { explicitSeries, namedSeries } from './series-metadata';
import type { CatalogBook, SeriesMembership } from './types';

export function primarySeries(book: { series?: string | null; seriesMemberships?: SeriesMembership[]; title?: string; subjects?: string[] }): SeriesMembership | null {
  if (book.seriesMemberships?.length) return book.seriesMemberships[0];
  return namedSeries(book.series) || explicitSeries(book.title || '', book.subjects || [])[0] || null;
}

export function seriesEligible(book: { series?: string | null; seriesMemberships?: SeriesMembership[] }, allowSeries: boolean) {
  if (book.series?.includes('[object Object]')) return false;
  const series = primarySeries(book);
  return !series || (allowSeries && series.position === 1);
}

export async function seriesCatalog(db: ShelfDb, series: SeriesMembership, author: string, signal?: AbortSignal) {
  const query = series.key ? `series_key:${series.key}` : `(series_name:${JSON.stringify(series.name)} OR subject:${JSON.stringify(`series:${series.name}`)}) author:${JSON.stringify(author)}`;
  const books = new Map<string, CatalogBook>();
  let complete = false;
  for (let page = 1; page <= 5; page++) {
    let result;
    try { result = await searchCatalogPage(db, { kind: 'series', query, reason: 'Verify series membership and reading order' }, page, signal); }
    catch (error) { if (!books.size) throw error; break; }
    for (const book of result.books) {
      const membership = book.seriesMemberships?.find(m => series.key ? m.key === series.key : normalize(m.name) === normalize(series.name) && normalize(book.author) === normalize(author));
      if (membership) books.set(book.key, { ...book, series: membership.name, seriesMemberships: [membership, ...(book.seriesMemberships || []).filter(m => m !== membership)] });
    }
    if (page * 40 >= result.total) { complete = true; break; }
  }
  return { books: [...books.values()].sort((a, b) => (primarySeries(a)?.position ?? Infinity) - (primarySeries(b)?.position ?? Infinity) || a.title.localeCompare(b.title)), complete };
}

/** Replace known sequels before assessment so explanations describe the first book itself. */
export async function startSeriesAtBookOne(db: ShelfDb, books: CatalogBook[], allowSeries: boolean, onStage: (stage: string) => void) {
  const selected = new Map<string, CatalogBook>();
  const lookups = new Map<string, Awaited<ReturnType<typeof seriesCatalog>>>();
  let skipped = 0;
  for (const [index, book] of books.entries()) {
    onStage(`Checking series starting points ${index + 1}/${books.length}`);
    if (book.series?.includes('[object Object]')) { skipped++; continue; }
    const series = primarySeries(book);
    if (!series) { selected.set(book.key, book); continue; }
    if (!allowSeries) { skipped++; continue; }
    if (series.position === 1) { selected.set(book.key, book); continue; }
    const key = series.key || `${normalize(series.name)}:${normalize(book.author)}`;
    try {
      if (!lookups.has(key)) {
        if (lookups.size >= 8) { skipped++; continue; }
        onStage(`Finding book one ${index + 1}/${books.length}: ${series.name}`);
        lookups.set(key, { books: [], complete: false });
        lookups.set(key, await seriesCatalog(db, series, book.author));
      }
      const found = lookups.get(key)!;
      const first = found.books.filter(b => primarySeries(b)?.position === 1);
      // Conflicting #1 entries or an incomplete list are not a verified starting point.
      if (!found.complete || first.length !== 1) { skipped++; continue; }
      const starter = await enrichBook(db, { ...first[0], strategies: book.strategies });
      selected.set(starter.key, starter);
    } catch { skipped++; }
  }
  return { books: [...selected.values()], skipped };
}
