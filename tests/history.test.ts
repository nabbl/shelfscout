import { afterEach, expect, it, vi } from 'vitest';
import { createDatabase } from '../src/lib/db';
import { parseGoodreadsCsv, importGoodreadsRows } from '../src/lib/goodreads';
import { listHistory, getHistoryBook, setReadingStatus } from '../src/lib/history';
import { findHistoryCover } from '../src/lib/history-cover';
import { buildProfile, hash } from '../src/lib/recommendation/profile';
import { rankContext } from '../src/lib/recommendation/engine';
import { CATALOG_FIELDS } from '../src/lib/recommendation/catalog';

const dbs: ReturnType<typeof createDatabase>[] = [];
afterEach(() => { dbs.splice(0).forEach(db => db.close()); vi.unstubAllGlobals(); });
function setup() { const db = createDatabase(':memory:'); dbs.push(db); return db; }
function importBook(db: ReturnType<typeof setup>, status = 'read', id = '1') {
  db.prepare("INSERT INTO imports(id,filename,stored_path,sha256,headers_json,preview_json,status,row_count,created_at) VALUES(?,'x','x','x','[]','{}','previewed',1,'now')").run(id);
  const rows = parseGoodreadsCsv(`Book Id,Title,Author,ISBN,ISBN13,My Rating,Exclusive Shelf,Read Count\n42,History Book,Fixture Writer,0306406152,9780306406158,4,${status},1\n`).rows;
  return importGoodreadsRows(db, id, rows);
}
it('preserves a local status through unchanged and changed imports, and restores the latest source on reset', () => {
  const db = setup(); importBook(db);
  const original = listHistory(db)[0];
  expect(setReadingStatus(db, original.work_key, 'to-read')).toBe(true);
  expect(importBook(db, 'read', '2').unchanged).toBe(1);
  expect(importBook(db, 'currently-reading', '3').updated).toBe(1);
  expect(getHistoryBook(db, original.id)).toMatchObject({ exclusive_status: 'to-read', imported_status: 'currently-reading', status_override: 'to-read', personal_rating: 4 });
  const source = db.prepare('SELECT exclusive_status,raw_json FROM reading_records').get() as {exclusive_status: string; raw_json: string};
  expect(source.exclusive_status).toBe('currently-reading');
  expect(JSON.parse(source.raw_json)['Exclusive Shelf']).toBe('currently-reading');
  setReadingStatus(db, original.work_key, null);
  expect(getHistoryBook(db, original.id)).toMatchObject({ exclusive_status: 'currently-reading', status_override: null });
  expect(setReadingStatus(db, 'missing', 'read')).toBe(false);
});
it('uses corrected statuses in taste evidence and read exclusion despite imported read counts and old ratings', () => {
  const db = setup(); importBook(db); const book = listHistory(db)[0];
  db.prepare('INSERT INTO companion_ratings VALUES(?,?,?)').run(book.work_key, 5, 'now');
  db.prepare("INSERT INTO feedback(work_key,action,created_at) VALUES(?,'already_read','now')").run(book.work_key);
  const input = { mood: '', mode: 'refresh' as const, rereads: false };
  const previous = buildProfile(db).version;
  setReadingStatus(db, book.work_key, 'to-read');
  expect(buildProfile(db).evidence[0]).toMatchObject({ status: 'to-read', rating: 5 });
  expect(buildProfile(db).version).not.toBe(previous);
  expect(rankContext(db, input).known.has(book.work_key)).toBe(false);
  for (const status of ['read', 'currently-reading'] as const) {
    setReadingStatus(db, book.work_key, status);
    expect(rankContext(db, input).known.has(book.work_key)).toBe(true);
  }
  setReadingStatus(db, book.work_key, 'to-read');
  db.prepare("UPDATE feedback SET created_at='2099-01-01T00:00:00.000Z'").run();
  expect(rankContext(db, input).known.has(book.work_key)).toBe(true);
  setReadingStatus(db, book.work_key, null);
  expect(rankContext(db, input).known.has(book.work_key)).toBe(true);
});
it('keeps literal searches and custom imported statuses, using a valid ISBN rather than an invalid ISBN13', () => {
  const db = setup(); importBook(db, 'custom-shelf');
  const book = listHistory(db, 'Fixture Writer')[0];
  expect(book).toMatchObject({ exclusive_status: 'custom-shelf', status_override: null, cover_url: 'https://covers.openlibrary.org/b/isbn/0306406152-L.jpg?default=false' });
  expect(listHistory(db, '%')).toEqual([]);
  expect(listHistory(db, '_')).toEqual([]);
  expect(getHistoryBook(db, 999)).toBeNull();
});
function cacheSearch(db: ReturnType<typeof setup>, docs: unknown[], total = docs.length) {
  const params = new URLSearchParams({ q: 'title:"History Book" author:"Fixture Writer"', fields: CATALOG_FIELDS, limit: '40', page: '1' });
  db.prepare('INSERT OR REPLACE INTO recommendation_cache VALUES(?,?,?)').run(`catalog-v3:${hash(params.toString())}`, JSON.stringify({ docs, numFound: total }), '2099-01-01');
}
it('uses only a unique exact title and author cover match and reuses the catalog cache', async () => {
  const db = setup(); vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network request'); }));
  const book = { title: 'History Book', author: 'Fixture Writer' };
  const doc = { key: '/works/OL1W', title: book.title, author_name: [book.author], cover_i: 123 };
  cacheSearch(db, [doc, { ...doc, key: '/works/OL2W', author_name: ['Wrong Writer'] }]);
  expect(await findHistoryCover(db, book)).toBe('https://covers.openlibrary.org/b/id/123-L.jpg?default=false');
  cacheSearch(db, [doc, { ...doc, key: '/works/OL2W' }]);
  expect(await findHistoryCover(db, book)).toBeNull();
  cacheSearch(db, [{ ...doc, title: 'Another Book' }]);
  expect(await findHistoryCover(db, book)).toBeNull();
  cacheSearch(db, [doc], 41);
  expect(await findHistoryCover(db, book)).toBeNull();
  expect(await findHistoryCover(db, { ...book, author: null })).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
