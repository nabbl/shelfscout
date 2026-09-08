import type { ShelfDb } from './db';
import { validIsbn } from './goodreads';
import type { HistoryBook, ReadingStatus } from './history-types';

const select = `SELECT r.id,r.work_key,r.title,r.author,
  COALESCE(c.rating,r.personal_rating) AS personal_rating,r.personal_rating AS imported_rating,
  COALESCE(s.status,r.exclusive_status) AS exclusive_status,r.exclusive_status AS imported_status,
  s.status AS status_override,r.date_read,r.date_added,r.shelves_json,r.isbn,r.isbn13,r.isbn_valid
  FROM reading_records r LEFT JOIN companion_ratings c ON c.work_key=r.work_key
  LEFT JOIN companion_reading_statuses s ON s.work_key=r.work_key`;

function withCover(row: Omit<HistoryBook, 'cover_url'>): HistoryBook {
  const isbn = [row.isbn13, row.isbn].find(value => validIsbn(value));
  return { ...row, cover_url: isbn ? `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false` : null };
}
export function listHistory(db: ShelfDb, query = ''): HistoryBook[] {
  const filter = `%${query.replace(/[%_\\]/g, '\\$&')}%`;
  const rows = query
    ? db.prepare(`${select} WHERE r.title LIKE ? ESCAPE '\\' OR r.author LIKE ? ESCAPE '\\' ORDER BY r.date_read DESC,r.id DESC LIMIT 200`).all(filter, filter)
    : db.prepare(`${select} ORDER BY r.date_read DESC,r.id DESC LIMIT 200`).all();
  return (rows as Omit<HistoryBook, 'cover_url'>[]).map(withCover);
}
export function getHistoryBook(db: ShelfDb, id: number): HistoryBook | null {
  const row = db.prepare(`${select} WHERE r.id=?`).get(id) as Omit<HistoryBook, 'cover_url'> | undefined;
  return row ? withCover(row) : null;
}
export function setReadingStatus(db: ShelfDb, workKey: string, status: ReadingStatus | null) {
  if (!db.prepare('SELECT id FROM reading_records WHERE work_key=?').get(workKey)) return false;
  if (status === null) db.prepare('DELETE FROM companion_reading_statuses WHERE work_key=?').run(workKey);
  else db.prepare('INSERT OR REPLACE INTO companion_reading_statuses(work_key,status,updated_at) VALUES(?,?,?)').run(workKey, status, new Date().toISOString());
  return true;
}
