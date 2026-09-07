import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { BookCandidate } from './bookorbit';
import { editionKey, workKey } from './identity';
import { languageCode, releaseAssessment } from './acquisition-identity';
import type { Release } from './shelfmark';

export interface Acquisition { id: string; title: string; author: string | null; isbn13: string | null; language: string; status: string; upstream_request_id: string | null; upstream_book_id: string | null; target_collection_id: string | null; last_error: string | null; }
export interface Flow { acquisition_id: string; phase: string; candidate_json: string; releases_json: string; release_json: string | null; release_source: string | null; release_id: string | null; download_attempted_at: string | null; download_seen_at: string | null; evidence_json: string | null; dock_file_id: number | null; import_attempted_at: string | null; library_id: number | null; folder_id: number | null; phase_started_at: string; }
export const acquisition = (db: Database.Database, id: string) => db.prepare('SELECT * FROM acquisitions WHERE id=?').get(id) as Acquisition | undefined;
export const flow = (db: Database.Database, id: string) => db.prepare('SELECT * FROM acquisition_flows WHERE acquisition_id=?').get(id) as Flow | undefined;
export function recordStatus(db: Database.Database, id: string, status: string, detail: string) {
  const previous = acquisition(db, id);
  const now = new Date().toISOString();
  db.prepare('UPDATE acquisitions SET status=?,last_error=?,updated_at=? WHERE id=?').run(status, status === 'needs_attention' ? detail : null, now, id);
  if (previous?.status !== status || (status === 'needs_attention' && previous.last_error !== detail)) db.prepare('INSERT INTO acquisition_events(acquisition_id,status,detail,created_at) VALUES(?,?,?,?)').run(id, status, detail, now);
}
export function queueAcquisition(db: Database.Database, id: string) {
  const active = db.prepare("SELECT id FROM jobs WHERE type!='recommendation' AND json_extract(payload_json,'$.id')=? AND status='queued'").get(id);
  if (!active) { const now = new Date().toISOString(); db.prepare('INSERT INTO jobs(id,type,payload_json,status,run_after,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(), 'reconcile_acquisition', JSON.stringify({ id }), 'queued', now, now, now); }
}
export function recoverAcquisitions(db: Database.Database) {
  db.transaction(() => {
    const rows = db.prepare("SELECT id FROM acquisitions WHERE status NOT IN ('ready_for_kobo','failed','cancelled','rejected','needs_attention')").all() as { id: string }[];
    for (const row of rows) queueAcquisition(db, row.id);
    // Old uncertain submissions may have lost their job between the request and DB write.
    for (const row of db.prepare("SELECT a.id FROM acquisitions a LEFT JOIN acquisition_flows f ON f.acquisition_id=a.id WHERE f.acquisition_id IS NULL AND a.status='needs_attention'").all() as {id:string}[]) queueAcquisition(db,row.id);
  }).immediate();
}
export async function submitAcquisition(db: Database.Database, candidate: BookCandidate, targetCollectionId?: string) {
  if (!candidate.author?.trim() || !candidate.language || languageCode(candidate.language) === 'und') throw new Error('Resolve the book author and language before acquisition.');
  if (!targetCollectionId || !/^[1-9]\d*$/.test(targetCollectionId)) throw new Error('Choose an existing Kobo-enabled collection.');
  return db.transaction(() => {
    // The intent and its job commit together before any upstream operation.
    const wk = workKey(candidate.title, candidate.author);
    const ek = `${editionKey(candidate)}:${languageCode(candidate.language)}`;
    const existing = (db.prepare("SELECT * FROM acquisitions WHERE (edition_key=? OR (work_key=? AND (? IS NULL OR isbn13=?)) OR (isbn13 IS NOT NULL AND isbn13=?)) AND status NOT IN ('failed','cancelled','rejected') ORDER BY created_at").all(ek, wk, candidate.isbn13 || null, candidate.isbn13 || null, candidate.isbn13 || null) as Acquisition[]).find(row => languageCode(row.language) === languageCode(candidate.language));
    if (existing) {
      const added = db.prepare('INSERT OR IGNORE INTO acquisition_targets(acquisition_id,collection_id) VALUES(?,?)').run(existing.id, targetCollectionId).changes;
      if (added && existing.upstream_book_id) { recordStatus(db, existing.id, 'available_in_bookorbit', 'Verifying additional collection membership.'); queueAcquisition(db, existing.id); }
      return { acquisition: acquisition(db, existing.id), idempotent: true };
    }
    const id = randomUUID(), now = new Date().toISOString();
    db.prepare('INSERT INTO acquisitions(id,work_key,edition_key,title,author,isbn13,language,preferred_formats_json,status,target_collection_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id, wk, ek, candidate.title, candidate.author, candidate.isbn13 || null, languageCode(candidate.language), '["epub"]', 'checking_ownership', targetCollectionId, now, now);
    db.prepare('INSERT INTO acquisition_flows(acquisition_id,phase,candidate_json,phase_started_at) VALUES(?,?,?,?)').run(id, 'checking_ownership', JSON.stringify(candidate), now);
    db.prepare('INSERT INTO acquisition_targets(acquisition_id,collection_id) VALUES(?,?)').run(id, targetCollectionId);
    queueAcquisition(db, id);
    return { acquisition: acquisition(db, id), idempotent: false };
  }).immediate();
}
export function updateAcquisition(db: Database.Database, id: string, action: 'recheck' | 'select_release', releaseIndex?: number) {
  return db.transaction(() => {
    const row = acquisition(db, id), f = flow(db, id);
    if (!row) throw new Error('Acquisition not found.');
    if (db.prepare("SELECT id FROM jobs WHERE type!='recommendation' AND status='running' AND json_extract(payload_json,'$.id')=?").get(id)) throw new Error('The worker is still processing this acquisition. Wait for its current step, then retry.');
    if (action === 'select_release') {
      if (!f || f.download_attempted_at || f.release_id || f.phase !== 'selecting_release') throw new Error('This acquisition is no longer awaiting a release selection.');
      const releases = JSON.parse(f.releases_json) as Release[];
      const release = releaseIndex === undefined ? undefined : releases[releaseIndex];
      if (!release || !releaseAssessment(JSON.parse(f.candidate_json), release).selectable) throw new Error('Choose a compatible EPUB release from this acquisition.');
      db.prepare("UPDATE acquisition_flows SET release_json=?,phase='submit_download',phase_started_at=? WHERE acquisition_id=?").run(JSON.stringify(release), new Date().toISOString(), id);
      recordStatus(db, id, 'searching_selecting', 'Release explicitly selected; preparing download.');
    } else {
      if (row.status === 'ready_for_kobo') return;
      if (f?.phase === 'selecting_release' && !f.download_attempted_at) db.prepare("UPDATE acquisition_flows SET phase='searching',phase_started_at=? WHERE acquisition_id=?").run(new Date().toISOString(), id);
      // Recheck resumes the saved phase. It never clears a submission marker.
      if (f) db.prepare('UPDATE acquisition_flows SET phase_started_at=? WHERE acquisition_id=?').run(new Date().toISOString(), id);
      recordStatus(db, id, row.upstream_book_id ? 'available_in_bookorbit' : 'checking_status', 'Rechecking saved upstream and file evidence.');
    }
    queueAcquisition(db, id);
  }).immediate();
}
export function publicAcquisitions(db: Database.Database) {
  const rows = db.prepare('SELECT id,title,author,language,status,last_error,updated_at,upstream_book_id,upstream_request_id FROM acquisitions ORDER BY created_at DESC LIMIT 200').all() as Acquisition[];
  return rows.map(row => {
    const f = flow(db, row.id);
    const releases = f?.phase === 'selecting_release' ? (JSON.parse(f.releases_json) as Release[]).map((r, index) => ({ index, title: r.title, author: r.extra?.author, isbn: r.extra?.isbn13 || r.extra?.isbn, year: r.extra?.year, source: r.source, language: r.language, format: r.format, size: r.size, ...releaseAssessment(JSON.parse(f!.candidate_json), r) })) : [];
    return { ...row, workflow: f ? 'shelfmark' : 'legacy_bookorbit', releases, events: db.prepare('SELECT status,detail,created_at FROM acquisition_events WHERE acquisition_id=? ORDER BY id DESC LIMIT 20').all(row.id) };
  });
}
// Kept for previously persisted BookOrbit Requests only.
export const normalizeStatus = (upstream: string, download?: string | null) => { if (upstream === 'available') return 'available_in_bookorbit'; if (upstream === 'needs_review') return 'needs_attention'; if (['failed', 'cancelled', 'rejected'].includes(upstream)) return upstream; if (download === 'downloading') return 'downloading'; if (['downloaded', 'importing'].includes(download || '')) return 'importing_finalizing'; if (['approved', 'searching', 'grabbed'].includes(upstream)) return 'searching_selecting'; return 'requested_waiting_approval'; };
