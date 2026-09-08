import type { ShelfDb } from './db';
import { normalize } from './identity';
import { searchCatalogPage } from './recommendation/catalog';

// Only use an unambiguous title/author match when the imported ISBN has no cover.
export async function findHistoryCover(db: ShelfDb, book: { title: string; author: string | null }, signal?: AbortSignal) {
  if (!book.author?.trim()) return null;
  const result = await searchCatalogPage(db, { kind: 'history', query: `title:${JSON.stringify(book.title)} author:${JSON.stringify(book.author)}`, reason: 'Find a cover for an imported history book' }, 1, signal);
  if (result.total > 40) return null;
  const matches = result.books.filter(candidate => normalize(candidate.title) === normalize(book.title) && normalize(candidate.author) === normalize(book.author!));
  return matches.length === 1 && matches[0].coverUrl ? `${matches[0].coverUrl}?default=false` : null;
}
