export const readingStatuses = [
  { value: 'read', label: 'Read' },
  { value: 'to-read', label: 'Want to read' },
  { value: 'currently-reading', label: 'Currently reading' },
  { value: 'dnf', label: 'Did not finish' },
  { value: 'on-hold', label: 'On hold' },
] as const;
export type ReadingStatus = typeof readingStatuses[number]['value'];
export function statusLabel(status: string | null) {
  return readingStatuses.find(option => option.value === status)?.label || status || 'Unknown';
}
export type HistoryBook = {
  id: number;
  work_key: string;
  title: string;
  author: string | null;
  personal_rating: number | null;
  imported_rating: number | null;
  exclusive_status: string | null;
  imported_status: string | null;
  status_override: ReadingStatus | null;
  date_read: string | null;
  date_added: string | null;
  shelves_json: string;
  isbn: string | null;
  isbn13: string | null;
  isbn_valid: number;
  cover_url: string | null;
};
