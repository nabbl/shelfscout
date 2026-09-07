-- Additive: rows without a flow continue reconciling their legacy BookOrbit request.
CREATE TABLE IF NOT EXISTS acquisition_flows (
  acquisition_id TEXT PRIMARY KEY REFERENCES acquisitions(id),
  phase TEXT NOT NULL,
  candidate_json TEXT NOT NULL,
  releases_json TEXT NOT NULL DEFAULT '[]',
  release_json TEXT,
  release_source TEXT,
  release_id TEXT,
  download_attempted_at TEXT,
  download_seen_at TEXT,
  evidence_json TEXT,
  dock_file_id INTEGER,
  import_attempted_at TEXT,
  library_id INTEGER,
  folder_id INTEGER,
  phase_started_at TEXT NOT NULL
);
-- Shelfmark itself keys tasks by source_id. Reserve it across all acquisitions,
-- including failures: an uncertain outcome must never allow another submission.
CREATE UNIQUE INDEX IF NOT EXISTS idx_flow_release ON acquisition_flows(release_id) WHERE release_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS acquisition_targets (
  acquisition_id TEXT NOT NULL REFERENCES acquisitions(id),
  collection_id TEXT NOT NULL,
  verified_at TEXT,
  PRIMARY KEY(acquisition_id, collection_id)
);
