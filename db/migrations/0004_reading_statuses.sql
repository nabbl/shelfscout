CREATE TABLE IF NOT EXISTS companion_reading_statuses (
  work_key TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('read','to-read','currently-reading','dnf','on-hold')),
  updated_at TEXT NOT NULL
);
