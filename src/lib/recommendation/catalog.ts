import { z } from 'zod';
import { setTimeout as delay } from 'node:timers/promises';
import type { ShelfDb } from '../db';
import { normalize, workKey } from '../identity';
import { cached } from './ai';
import { hash } from './profile';
import type { CatalogBook, Profile, SeriesMembership } from './types';
import { explicitSeries, namedSeries, seriesPosition } from './series-metadata';
export { seriesPosition } from './series-metadata';
const docSchema = z.object({ key: z.string().regex(/^\/works\/OL\d+W$/), title: z.string().min(1).max(500), author_name: z.array(z.string()).min(1), first_publish_year: z.number().optional(), cover_i: z.number().optional(), isbn: z.array(z.string()).optional(), language: z.array(z.string()).optional(), subject: z.array(z.string()).optional(), series_key: z.array(z.string()).optional(), series_name: z.array(z.string()).optional(), series_position: z.array(z.union([z.string(), z.number(), z.null()])).optional() });
export type Strategy = {
    kind: string;
    query: string;
    reason: string;
};
export function defaultStrategies(profile: Profile, mood: string): Strategy[] { const positive = profile.preferences.filter(p => p.direction === 'prefer').slice(0, 5); const authors = [...new Set(profile.evidence.filter(e => (e.rating || 0) >= 4).map(e => e.author).filter(Boolean))].slice(0, 2); return [...(mood ? [{ kind: 'mood', query: mood, reason: 'Current mood' }] : []), ...positive.map(p => ({ kind: 'theme', query: `subject:${JSON.stringify(p.value)}`, reason: `Preference ${p.id}` })), ...authors.map(a => ({ kind: 'author', query: `author:${JSON.stringify(a)}`, reason: 'Another work by a positively rated author; enjoyment is unproven' })), { kind: 'exploration', query: 'subject:"translated fiction"', reason: 'Explore translated fiction' }, { kind: 'exploration', query: 'subject:"short stories"', reason: 'Explore a different narrative form' }, ...(positive.length ? [] : [{ kind: 'exploration', query: 'subject:"literary fiction"', reason: 'Sparse profile: broad discovery, not personalized fit' }])].slice(0, 10); }
export const CATALOG_FIELDS = 'key,title,author_name,first_publish_year,cover_i,isbn,language,subject,series_key,series_name,series_position';

function memberships(doc: z.infer<typeof docSchema>): SeriesMembership[] {
  const structured = (doc.series_name || []).slice(0, 8).flatMap((name, index) => name.trim() ? [{ name: name.trim().slice(0, 200), key: /^OL\d+L$/.test(doc.series_key?.[index] || '') ? doc.series_key![index] : null, position: seriesPosition(doc.series_position?.[index]) }] : []);
  return structured.length ? structured : explicitSeries(doc.title, doc.subject || []);
}
export class CatalogError extends Error {
  constructor(message: string, public readonly retryable = false) { super(message); }
}
let nextCatalogRequest = 0;
export async function catalogJson(path: string, signal?: AbortSignal) {
  if (!/^\/(?:search\.json\?|works\/OL\d+W\.json|authors\/OL\d+A\.json|series\/OL\d+L\.json)/.test(path)) throw new CatalogError('Invalid catalog path.');
  for (let attempt = 0; attempt < 2; attempt++) {
    signal?.throwIfAborted();
    const wait = Math.max(0, nextCatalogRequest - Date.now());
    nextCatalogRequest = Math.max(Date.now(), nextCatalogRequest) + 1000;
    if (wait) await delay(wait, undefined, { signal });
    signal?.throwIfAborted();
    try {
      const timeout = AbortSignal.timeout(10000);
      const r = await fetch(`https://openlibrary.org${path}`, { redirect: 'error', headers: { 'User-Agent': 'ShelfScout/0.2 (private reading companion)' }, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      if (!r.ok) {
        await r.body?.cancel();
        throw new CatalogError(r.status === 429 ? 'Open Library is limiting requests. Please try again shortly.' : `Open Library returned HTTP ${r.status}. Please retry later.`, [500, 502, 503, 504].includes(r.status));
      }
      const raw = await r.text();
      if (raw.length > 8000000) throw new CatalogError('Open Library returned too much data.');
      try { return JSON.parse(raw); } catch { throw new CatalogError('Open Library returned an invalid response. Please retry later.'); }
    } catch (error) {
      if (attempt === 0 && !signal?.aborted && (!(error instanceof CatalogError) || error.retryable)) continue;
      if (error instanceof CatalogError) throw error;
      throw new CatalogError('Could not reach Open Library after retrying. Check the connection and try again.');
    }
  }
}
export async function searchCatalogPage(db: ShelfDb, strategy: Strategy, page = 1, signal?: AbortSignal): Promise<{books: CatalogBook[]; total: number}> {
  const params = new URLSearchParams({ q: strategy.query, fields: CATALOG_FIELDS, limit: '40', page: String(page) });
  const raw = await cached(db, `catalog-v3:${hash(params.toString())}`, 86400000, () => catalogJson(`/search.json?${params}`, signal)) as { docs?: unknown[]; numFound?: number; num_found?: number };
  if (!Array.isArray(raw.docs)) throw new Error('Invalid catalog search response');
  const books = raw.docs.flatMap(d => {
    const parsed = docSchema.safeParse(d); if (!parsed.success) return [];
    const v = parsed.data, seriesMemberships = memberships(v);
    return [{ key: v.key, title: v.title, author: v.author_name[0], year: v.first_publish_year ?? null, isbns: (v.isbn || []).filter(s => /^\d{13}$/.test(s)), language: v.language?.includes('eng') ? 'eng' : v.language?.[0] || 'und', languages: v.language || [], coverUrl: v.cover_i ? `https://covers.openlibrary.org/b/id/${v.cover_i}-L.jpg` : null, subjects: (v.subject || []).slice(0, 40).map(s => s.slice(0, 160)), description: '', series: seriesMemberships[0]?.name || null, seriesMemberships, strategies: [strategy.query] }];
  });
  return { books, total: raw.numFound ?? raw.num_found ?? (raw.docs.length === 40 ? page * 40 + 1 : (page - 1) * 40 + raw.docs.length) };
}
export async function searchCatalog(db: ShelfDb, strategy: Strategy, page = 1): Promise<CatalogBook[]> { return (await searchCatalogPage(db, strategy, page)).books; }
export async function enrichBook(db: ShelfDb, book: CatalogBook, signal?: AbortSignal): Promise<CatalogBook> { if (!/^\/works\/OL\d+W$/.test(book.key))
    throw new Error('Invalid work identity'); const raw = await cached(db, `work-v2:${book.key}`, 7 * 86400000, () => catalogJson(`${book.key}.json`, signal)) as Record<string, unknown>; if (raw.key !== book.key || normalize(String(raw.title || '')) !== normalize(book.title))
    throw new Error('Catalog work identity mismatch'); const description = typeof raw.description === 'string' ? raw.description : typeof raw.description === 'object' && raw.description ? String((raw.description as {
    value?: unknown;
}).value || '') : '';
  const seriesMemberships = await workSeries(db, raw, book, signal);
  return { ...book, description: description.slice(0, 5000), series: seriesMemberships[0]?.name || null, seriesMemberships, subjects: Array.isArray(raw.subjects) ? raw.subjects.filter((s): s is string => typeof s === 'string').slice(0, 40) : book.subjects };
}

async function workSeries(db: ShelfDb, raw: Record<string, unknown>, book: CatalogBook, signal?: AbortSignal): Promise<SeriesMembership[]> {
  const entries = Array.isArray(raw.series) ? raw.series.slice(0, 8) : [];
  const result: SeriesMembership[] = [];
  for (const entry of entries) {
    if (typeof entry === 'string') { const parsed = namedSeries(entry); if (parsed) result.push(parsed); continue; }
    const parsed = z.object({ series: z.object({ key: z.string().regex(/^\/series\/OL\d+L$/) }), position: z.unknown().optional() }).safeParse(entry);
    if (!parsed.success) continue;
    const path = parsed.data.series.key, key = path.slice('/series/'.length);
    const known = book.seriesMemberships?.find(s => s.key === key);
    if (known) { result.push({ ...known, position: seriesPosition(parsed.data.position) }); continue; }
    const info = await cached(db, `series-name-v1:${key}`, 7 * 86400000, () => catalogJson(`${path}.json`, signal)) as { name?: unknown; key?: string; links?: { self?: string } };
    if ((info.key !== path && info.links?.self !== path) || typeof info.name !== 'string' || !info.name.trim()) throw new CatalogError('Open Library returned inconsistent series information.');
    result.push({ key, name: info.name.trim().slice(0, 200), position: seriesPosition(parsed.data.position) });
  }
  if (result.length) return result;
  if (book.seriesMemberships?.length) return book.seriesMemberships;
  const legacy = namedSeries(book.series);
  return legacy ? [legacy] : explicitSeries(book.title, Array.isArray(raw.subjects) ? raw.subjects.filter((s): s is string => typeof s === 'string') : book.subjects);
}

/** Search already includes series data; a description fetch must not block that lookup. */
export async function resolveSeriesWork(db: ShelfDb, key: string, signal?: AbortSignal): Promise<CatalogBook> {
  let searchError: unknown;
  try {
    const result = await searchCatalogPage(db, { kind: 'series', query: `key:${JSON.stringify(key)}`, reason: 'Resolve series for this catalog work' }, 1, signal);
    const book = result.books.find(b => b.key === key);
    if (book) return book.seriesMemberships?.length ? book : await enrichBook(db, book, signal);
  } catch (error) { searchError = error; }
  // Direct work records also work when the search index is unavailable or behind.
  try {
    const raw = await cached(db, `work-v2:${key}`, 7 * 86400000, () => catalogJson(`${key}.json`, signal)) as Record<string, unknown>;
    const parsed = z.object({ key: z.literal(key), title: z.string().min(1).max(500), authors: z.array(z.object({ author: z.object({ key: z.string().regex(/^\/authors\/OL\d+A$/) }) })).min(1) }).safeParse(raw);
    if (!parsed.success) throw new CatalogError('This book could not be resolved in Open Library.');
    const authorKey = parsed.data.authors[0].author.key;
    const author = await cached(db, `author-v1:${authorKey}`, 7 * 86400000, () => catalogJson(`${authorKey}.json`, signal)) as { key?: string; name?: unknown };
    if (author.key !== authorKey || typeof author.name !== 'string' || !author.name.trim()) throw new CatalogError('This book’s author could not be verified in Open Library.');
    return await enrichBook(db, { key, title: parsed.data.title, author: author.name, year: null, isbns: [], language: 'und', coverUrl: null, subjects: [], description: '', series: null, strategies: [] }, signal);
  } catch (error) { throw searchError || error; }
}
export function resolveAliases(db: ShelfDb, books: CatalogBook[]) { const records = db.prepare('SELECT work_key,title,author,isbn,isbn13,isbn_valid FROM reading_records').all() as {
    work_key: string;
    title: string;
    author: string;
    isbn: string | null;
    isbn13: string | null;
    isbn_valid: number;
}[]; for (const b of books) {
    db.prepare("INSERT OR IGNORE INTO work_aliases VALUES(?,?,?)").run(workKey(b.title, b.author), b.key, "Catalog title and author observed for this work");
    const matches = records.filter(r => r.isbn_valid && Boolean(r.isbn13 && b.isbns.includes(r.isbn13)));
    const keys = [...new Set(matches.map(r => r.work_key))];
    if (keys.length > 1) {
            db.prepare("DELETE FROM work_aliases WHERE catalog_key=? AND provenance='Catalog search returned exact valid imported ISBN13'").run(b.key);
            db.prepare('INSERT OR IGNORE INTO identity_conflicts VALUES(?,?,?,NULL,?)').run(b.key,b.title,JSON.stringify(keys),new Date().toISOString());
        }
        if (keys.length === 1)
        db.prepare('INSERT OR IGNORE INTO work_aliases VALUES(?,?,?)').run(keys[0], b.key, 'Catalog search returned exact valid imported ISBN13');
    const direct = records.filter(r => workKey(b.title, b.author) === r.work_key);
    if (direct.length)
        db.prepare('INSERT OR IGNORE INTO work_aliases VALUES(?,?,?)').run(direct[0].work_key, b.key, 'Exact normalized title and author; conservative local identity');
} }
