import type { ShelfDb } from '../db';
import { workKey } from '../identity';
import { CatalogError, resolveSeriesWork } from './catalog';
import { rankContext } from './engine';
import { primarySeries, seriesCatalog } from './series';
import type { SeriesResult } from './types';

export async function browseSeries(db: ShelfDb, key: string): Promise<SeriesResult> {
  if (!/^\/works\/OL\d+W$/.test(key)) throw new CatalogError('A valid catalog work is required.');
  const cacheKey = `series-browse-v1:${key}`;
  const saved = db.prepare('SELECT value_json FROM recommendation_cache WHERE key=? AND expires_at>?').get(cacheKey, new Date().toISOString()) as { value_json: string } | undefined;
  const previous = saved ? JSON.parse(saved.value_json) as SeriesResult : null;
  let result: SeriesResult;
  if (previous && Date.now() - Date.parse(previous.checkedAt) < 86400000) result = previous;
  else {
    try {
      const signal = AbortSignal.timeout(45000);
      const book = await resolveSeriesWork(db, key, signal);
      const series = primarySeries(book);
      const members = series ? await seriesCatalog(db, series, book.author, signal) : { books: [], complete: false };
      result = {
        series, complete: members.complete, checkedAt: new Date().toISOString(), stale: false,
        books: members.books.map(member => ({ key: member.key, title: member.title, author: member.author, position: primarySeries(member)?.position ?? null, sourceUrl: `https://openlibrary.org${member.key}`, language: member.language, coverUrl: member.coverUrl, year: member.year })),
        message: !series ? 'Open Library has no verified series information for this book.' : members.complete ? 'Catalog order is shown where known. This list may not include every book in the series.' : 'Only part of the series could be checked. You can get the listed books, but book one and full coverage are not verified.',
      };
      // Retain a full previous list if a later lookup only retrieves part of it.
      if (previous?.complete && series && !members.complete) result = { ...previous, stale: true, message: 'Open Library could not refresh the full series. Showing the previously checked list; coverage may be incomplete.' };
      else if (members.complete || !series) db.prepare('INSERT OR REPLACE INTO recommendation_cache VALUES(?,?,?)').run(cacheKey, JSON.stringify(result), new Date(Date.now() + 7 * 86400000).toISOString());
    } catch (error) {
      if (!previous) throw error;
      result = { ...previous, stale: true, message: 'Open Library is unavailable. Showing the previously checked list; coverage may be incomplete.' };
    }
  }
  const context = rankContext(db, { mood: '', mode: 'refresh', rereads: false });
  const acquisitions = db.prepare("SELECT a.work_key,a.upstream_book_id,f.candidate_json FROM acquisitions a LEFT JOIN acquisition_flows f ON f.acquisition_id=a.id WHERE a.status NOT IN ('failed','cancelled','rejected')").all() as { work_key: string; upstream_book_id: string | null; candidate_json: string | null }[];
  const requested = new Set<string>(), owned = new Set<string>();
  for (const row of acquisitions) {
    const providerId = row.candidate_json ? JSON.parse(row.candidate_json).providerId : null;
    for (const id of [row.work_key, providerId].filter(Boolean)) { requested.add(id); if (row.upstream_book_id) owned.add(id); }
  }
  return { ...result, books: result.books.map(member => {
    const keys = [workKey(member.title, member.author), member.key, ...(context.aliases.get(member.key) || [])];
    return { ...member, read: keys.some(k => context.known.has(k)), owned: keys.some(k => owned.has(k)), requested: keys.some(k => requested.has(k) || context.requested.has(k)) };
  }) };
}
