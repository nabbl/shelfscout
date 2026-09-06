CREATE TABLE IF NOT EXISTS taste_profile (id INTEGER PRIMARY KEY CHECK(id=1), settings_json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS recommendation_cache (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS recommendation_batches (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, input_json TEXT NOT NULL, status TEXT NOT NULL, stage TEXT NOT NULL, result_json TEXT, error TEXT, created_at TEXT NOT NULL, completed_at TEXT);
CREATE TABLE IF NOT EXISTS recommendation_exposures (batch_id TEXT NOT NULL REFERENCES recommendation_batches(id), work_key TEXT NOT NULL, catalog_key TEXT NOT NULL, author TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(batch_id,work_key));
CREATE TABLE IF NOT EXISTS work_aliases (work_key TEXT NOT NULL, catalog_key TEXT NOT NULL, provenance TEXT NOT NULL, PRIMARY KEY(work_key,catalog_key));
CREATE TABLE IF NOT EXISTS feedback_undo (feedback_id INTEGER PRIMARY KEY REFERENCES feedback(id), created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS companion_ratings (work_key TEXT PRIMARY KEY, rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS identity_conflicts (catalog_key TEXT PRIMARY KEY, title TEXT NOT NULL, possible_work_keys_json TEXT NOT NULL, resolution TEXT, created_at TEXT NOT NULL);
