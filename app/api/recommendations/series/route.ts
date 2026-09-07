import { requireOwnerApi } from '@/src/lib/auth';
import { getDb } from '@/src/lib/db';
import { workKey } from '@/src/lib/identity';
import { enrichBook, searchCatalog } from '@/src/lib/recommendation/catalog';
import { rankContext } from '@/src/lib/recommendation/engine';
import { primarySeries, seriesCatalog } from '@/src/lib/recommendation/series';

export async function GET(request: Request) {
  const auth = await requireOwnerApi(); if (auth) return auth;
  const key = new URL(request.url).searchParams.get('work') || '';
  if (!/^\/works\/OL\d+W$/.test(key)) return Response.json({ error: 'A valid catalog work is required.' }, { status: 400 });
  try {
    const db = getDb();
    const matches = await searchCatalog(db, { kind: 'series', query: `key:${JSON.stringify(key)}`, reason: 'Resolve series for this catalog work' });
    const found = matches.find(book => book.key === key);
    if (!found) return Response.json({ error: 'This book could not be resolved in the catalog.' }, { status: 404 });
    const book = await enrichBook(db, found);
    const series = primarySeries(book);
    if (!series) return Response.json({ series: null, books: [], complete: false, message: 'The catalog has no verified series information for this book.' });
    const result = await seriesCatalog(db, series, book.author);
    const context = rankContext(db, { mood: '', mode: 'refresh', rereads: false });
    const books = result.books.map(member => ({ key: member.key, title: member.title, author: member.author, position: primarySeries(member)?.position ?? null, sourceUrl: `https://openlibrary.org${member.key}`, read: [workKey(member.title, member.author), member.key, ...(context.aliases.get(member.key) || [])].some(key => context.known.has(key)) }));
    return Response.json({ series, books, complete: result.complete, message: result.complete ? 'Catalog order shown where known. Series coverage may be incomplete.' : 'Showing the available portion of this series; the catalog lookup reached its limit.' }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'Series lookup is temporarily unavailable. Please retry.' }, { status: 502 });
  }
}
