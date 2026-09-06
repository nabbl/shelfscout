PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS imports (
  id TEXT PRIMARY KEY, filename TEXT NOT NULL, stored_path TEXT NOT NULL,
  sha256 TEXT NOT NULL, headers_json TEXT NOT NULL, preview_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('previewed','committed','failed')),
  row_count INTEGER NOT NULL, created_at TEXT NOT NULL, committed_at TEXT
);
CREATE TABLE IF NOT EXISTS reading_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL DEFAULT 'goodreads',
  source_book_id TEXT, work_key TEXT NOT NULL, edition_key TEXT NOT NULL,
  title TEXT NOT NULL, author TEXT, isbn_original TEXT, isbn TEXT,
  isbn13_original TEXT, isbn13 TEXT, isbn_valid INTEGER NOT NULL DEFAULT 0,
  personal_rating REAL, community_rating_snapshot REAL, exclusive_status TEXT,
  shelves_json TEXT NOT NULL DEFAULT '[]', date_read TEXT, date_added TEXT,
  date_precision TEXT, review TEXT, read_count INTEGER, owned INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT NOT NULL, source_hash TEXT NOT NULL, companion_updated_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reading_source_id ON reading_records(source, source_book_id) WHERE source_book_id IS NOT NULL AND source_book_id != '';
CREATE INDEX IF NOT EXISTS idx_reading_work_key ON reading_records(work_key);
CREATE INDEX IF NOT EXISTS idx_reading_title_author ON reading_records(title, author);
CREATE TABLE IF NOT EXISTS import_rows (
  import_id TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE, row_number INTEGER NOT NULL,
  reading_record_id INTEGER REFERENCES reading_records(id), disposition TEXT NOT NULL,
  reason TEXT, PRIMARY KEY(import_id,row_number)
);
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT, work_key TEXT NOT NULL, action TEXT NOT NULL
  CHECK(action IN ('already_read','not_interested','not_now','saved','get_book')),
  reason TEXT, candidate_json TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_work_action ON feedback(work_key,action);
CREATE TABLE IF NOT EXISTS acquisitions (
  id TEXT PRIMARY KEY, work_key TEXT NOT NULL, edition_key TEXT NOT NULL,
  title TEXT NOT NULL, author TEXT, isbn13 TEXT, language TEXT NOT NULL,
  preferred_formats_json TEXT NOT NULL, status TEXT NOT NULL, upstream_request_id TEXT,
  upstream_book_id TEXT, target_collection_id TEXT, upstream_state_json TEXT,
  last_error TEXT, submit_attempted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_acquisition_active_edition ON acquisitions(edition_key) WHERE status NOT IN ('failed','cancelled');
CREATE TABLE IF NOT EXISTS acquisition_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, acquisition_id TEXT NOT NULL REFERENCES acquisitions(id) ON DELETE CASCADE,
  status TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL
  CHECK(status IN ('queued','running','complete','failed')), attempts INTEGER NOT NULL DEFAULT 0,
  run_after TEXT NOT NULL, locked_at TEXT, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_ready ON jobs(status,run_after);
CREATE TABLE IF NOT EXISTS ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT, work_key TEXT NOT NULL, source TEXT NOT NULL,
  source_identifier TEXT, marketplace TEXT, rating REAL, rating_count INTEGER,
  retrieval_status TEXT NOT NULL, last_attempted_at TEXT NOT NULL, last_success_at TEXT,
  source_url TEXT NOT NULL, raw_json TEXT, UNIQUE(work_key,source,marketplace)
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, secret INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
);

