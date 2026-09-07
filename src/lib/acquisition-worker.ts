import type Database from 'better-sqlite3';
import path from 'node:path';
import { acquisition, flow, normalizeStatus, recordStatus, type Acquisition, type Flow } from './acquisition';
import { BookOrbitClient, type BookCandidate, type DockFile } from './bookorbit';
import { ShelfmarkClient, type Release } from './shelfmark';
import { metadataMatches, releaseAssessment } from './acquisition-identity';
import { checkIncomingDirectory, incomingEvidence, sameFile, type FileEvidence } from './acquisition-files';

type Evidence = { baselineDockIds: number[]; file?: FileEvidence; taskAddedTime?: number };
export interface AcquisitionAdapters { bo: BookOrbitClient; shelfmark: () => ShelfmarkClient; evidence: typeof incomingEvidence; now: () => number; }
const candidateFor = (row: Acquisition): BookCandidate => ({ title: row.title, author: row.author, isbn13: row.isbn13, language: row.language });
function attention(db: Database.Database, id: string, detail: string) { recordStatus(db, id, 'needs_attention', detail); return false; }
function phase(db: Database.Database, id: string, value: string, status = value) {
  db.prepare('UPDATE acquisition_flows SET phase=?,phase_started_at=? WHERE acquisition_id=?').run(value, new Date().toISOString(), id);
  recordStatus(db, id, status, status.replaceAll('_', ' '));
}
function setBook(db: Database.Database, id: string, bookId: number) {
  db.prepare('UPDATE acquisitions SET upstream_book_id=? WHERE id=?').run(String(bookId), id);
  phase(db, id, 'available', 'available_in_bookorbit');
}
async function verifyBook(bo: BookOrbitClient, c: BookCandidate, bookId: string, f?: Flow) {
  const book = await bo.book(bookId);
  if (!metadataMatches(c, book)) throw new Error('BookOrbit identity does not match the requested title, author, language and ISBN. Review its metadata.');
  const files = Array.isArray(book.files) ? book.files as { id: number; format: string; sizeBytes: number }[] : [];
  const epubs = files.filter(file => file.format?.toLowerCase() === 'epub');
  if (!epubs.length) throw new Error('BookOrbit has no verified EPUB for this book.');
  const evidence = f?.evidence_json ? JSON.parse(f.evidence_json) as Evidence : undefined;
  if (f?.import_attempted_at && evidence?.file) {
    if (book.libraryId !== f.library_id) throw new Error('Imported book is in a different library. Review the Book Dock target.');
    let matched = false;
    for (const epub of epubs.filter(file => file.sizeBytes === evidence.file!.size)) {
      const digest = await bo.fileDigest(epub.id);
      if (digest.sha256 === evidence.file.sha256 && digest.size === evidence.file.size) { matched = true; break; }
    }
    if (!matched) throw new Error('Imported EPUB checksum does not match the completed Shelfmark file. Review import identity; no collection was changed.');
  }
}
async function finishCollections(db: Database.Database, row: Acquisition, bo: BookOrbitClient, f?: Flow) {
  await verifyBook(bo, f ? JSON.parse(f.candidate_json) : candidateFor(row), row.upstream_book_id!, f);
  if (row.target_collection_id) db.prepare('INSERT OR IGNORE INTO acquisition_targets(acquisition_id,collection_id) VALUES(?,?)').run(row.id, row.target_collection_id);
  const targets = db.prepare('SELECT collection_id FROM acquisition_targets WHERE acquisition_id=?').all(row.id) as { collection_id: string }[];
  if (!targets.length) return attention(db, row.id, 'Book is available. Choose a Kobo-enabled collection with Get book.');
  const collections = await bo.collections();
  for (const target of targets) {
    if (!collections.some(c => String(c.id) === target.collection_id && c.syncToKobo)) return attention(db, row.id, 'Target collection is missing or no longer Kobo-enabled. Restore it in BookOrbit, then Recheck.');
    // Read before write also recovers a lost response to an idempotent collection add.
    if (!await bo.hasCollectionBook(target.collection_id, row.upstream_book_id!)) await bo.addToCollection(target.collection_id, row.upstream_book_id!);
    if (!await bo.hasCollectionBook(target.collection_id, row.upstream_book_id!)) return attention(db, row.id, 'Collection membership was not confirmed. Recheck after reviewing BookOrbit permissions.');
    db.prepare('UPDATE acquisition_targets SET verified_at=? WHERE acquisition_id=? AND collection_id=?').run(new Date().toISOString(), row.id, target.collection_id);
  }
  return db.transaction(() => {
    if (db.prepare('SELECT 1 FROM acquisition_targets WHERE acquisition_id=? AND verified_at IS NULL').get(row.id)) {
      recordStatus(db, row.id, 'available_in_bookorbit', 'Verifying an additional collection selected during processing.');
      return true;
    }
    recordStatus(db, row.id, 'ready_for_kobo', 'EPUB identity and Kobo-enabled collection membership verified. Ready for Kobo sync; device delivery is not confirmed.');
    return false;
  }).immediate();
}
async function validateDockSetup(bo: BookOrbitClient) {
  const settings = await bo.dockSettings();
  if (!process.env.BOOKORBIT_DOCK_DIR || path.posix.normalize(settings.bookDockPath) !== path.posix.normalize(process.env.BOOKORBIT_DOCK_DIR)) throw new Error('BookOrbit Book Dock path does not match BOOKORBIT_DOCK_DIR. Verify the shared host-directory mapping.');
  if (settings.autoFinalizeEnabled !== false) throw new Error('Book Dock auto-finalization must be disabled for ShelfScout to verify files before import. Review BookOrbit settings, then Recheck.');
}
function validateDockFile(c: BookCandidate, file: DockFile, evidence: FileEvidence) {
  if (file.status !== 'ready' || file.fileName !== evidence.name || file.fileSize !== evidence.size || file.format?.toLowerCase() !== 'epub' || !Array.isArray(file.unitFiles) || file.unitFiles.length) throw new Error('Book Dock file evidence changed or represents a multi-file unit. Review this entry.');
  if (!metadataMatches(c, file.embeddedMetadata) || !metadataMatches(c, file.selectedMetadata)) throw new Error('Embedded or selected Book Dock metadata does not match the requested title, author, language and ISBN. Review this file before import.');
}
async function reconcileLegacy(db: Database.Database, row: Acquisition, bo: BookOrbitClient) {
  if (row.upstream_book_id) return finishCollections(db, row, bo);
  let requestId = row.upstream_request_id;
  if (!requestId) {
    const found = await bo.availability(candidateFor(row));
    if (found.ownedBookId) { db.prepare('UPDATE acquisitions SET upstream_book_id=? WHERE id=?').run(String(found.ownedBookId), row.id); recordStatus(db, row.id, 'available_in_bookorbit', 'Legacy owned book recovered.'); return true; }
    if (!found.existingRequestId) return attention(db, row.id, 'Legacy submission has no identifiable request or owned book. Review BookOrbit Requests manually; ShelfScout will not repeat the download.');
    requestId = String(found.existingRequestId);
    db.prepare('UPDATE acquisitions SET upstream_request_id=? WHERE id=?').run(requestId, row.id);
  }
  const upstream = await bo.requestStatus(requestId);
  const download = upstream.download as { status?: string } | undefined;
  const status = normalizeStatus(String(upstream.status), download?.status);
  if (status === 'available_in_bookorbit') {
    if (!Number.isSafeInteger(upstream.matchedBookId) || Number(upstream.matchedBookId) < 1) return attention(db, row.id, 'Legacy request is available without a matched book ID. Review BookOrbit Requests.');
    db.prepare('UPDATE acquisitions SET upstream_book_id=? WHERE id=?').run(String(upstream.matchedBookId), row.id);
  }
  recordStatus(db, row.id, status, status === 'needs_attention' ? 'Legacy BookOrbit request needs review in BookOrbit Requests; then Recheck here.' : `Legacy BookOrbit request: ${String(upstream.status)}`);
  return !['needs_attention', 'failed', 'cancelled', 'rejected'].includes(status);
}
/** One durable step. true requeues the same job; false completes it. */
export async function reconcileAcquisition(db: Database.Database, id: string, adapters?: AcquisitionAdapters): Promise<boolean> {
  const row = acquisition(db, id);
  if (!row || row.status === 'ready_for_kobo') return false;
  const f = flow(db, id);
  try {
    const deps = adapters || { bo: new BookOrbitClient(), shelfmark: () => new ShelfmarkClient(), evidence: incomingEvidence, now: Date.now };
    const { bo } = deps;
    if (!f) return await reconcileLegacy(db, row, bo);
    const c = JSON.parse(f.candidate_json) as BookCandidate;
    if (row.upstream_book_id) return await finishCollections(db, row, bo, f);
    if (deps.now() - Date.parse(f.phase_started_at) > 24 * 3600_000) return attention(db, id, 'This stage has waited over 24 hours. Review the upstream activity and folder mapping, then Recheck. No download will be repeated.');
    if (f.phase === 'checking_ownership') {
      const available = await bo.availability(c);
      if (available.ownedBookId) { setBook(db, id, available.ownedBookId); return true; }
      // Existing legacy requests can be joined read-only, never replaced by a download.
      if (available.existingRequestId) {
        db.prepare('UPDATE acquisitions SET upstream_request_id=? WHERE id=?').run(String(available.existingRequestId), id);
        phase(db, id, 'legacy_request', 'requested_waiting_approval'); return true;
      }
      phase(db, id, 'searching', 'searching_selecting'); return true;
    }
    if (f.phase === 'legacy_request') return await reconcileLegacy(db, row, bo);
    const sm = deps.shelfmark();
    if (f.phase === 'searching') {
      const result = await sm.search(c);
      if (!Array.isArray(result.releases)) throw new Error('Shelfmark release search contract is incompatible.');
      const releases = result.releases.filter(r => typeof r.source === 'string' && !!r.source && typeof r.source_id === 'string' && !!r.source_id && typeof r.title === 'string').slice(0, 500);
      db.prepare('UPDATE acquisition_flows SET releases_json=? WHERE acquisition_id=?').run(JSON.stringify(releases), id);
      const compatible = releases.filter(r => releaseAssessment(c, r).selectable);
      // Even a single title/language match needs explicit edition confirmation without ISBN evidence.
      if (compatible.length === 1 && releaseAssessment(c, compatible[0]).exact && !result.errors?.length) {
        db.prepare('UPDATE acquisition_flows SET release_json=? WHERE acquisition_id=?').run(JSON.stringify(compatible[0]), id);
        phase(db, id, 'submit_download', 'searching_selecting'); return true;
      }
      phase(db, id, 'selecting_release', 'needs_attention');
      return attention(db, id, compatible.length ? 'Choose and confirm a release below. Edition evidence is incomplete or multiple releases match.' : 'No compatible EPUB release found. Check sources and book identity, then Recheck to search again.');
    }
    if (f.phase === 'selecting_release') return false;
    const release = f.release_json ? JSON.parse(f.release_json) as Release : undefined;
    if (!release) return attention(db, id, 'Saved release is missing. Review acquisition data.');
    if (f.phase === 'submit_download' && !f.download_attempted_at) {
      await validateDockSetup(bo);
      const library = Number(process.env.BOOKORBIT_LIBRARY_ID), folder = Number(process.env.BOOKORBIT_FOLDER_ID);
      if (!Number.isSafeInteger(library) || library < 1 || !Number.isSafeInteger(folder) || folder < 1 || !process.env.SHELFSCOUT_INCOMING_DIR || !process.env.SHELFMARK_OUTPUT_DIR) throw new Error('Configure BOOKORBIT_LIBRARY_ID, BOOKORBIT_FOLDER_ID and the incoming-folder mapping before downloading.');
      await checkIncomingDirectory();
      const collections = await bo.collections();
      const targets = db.prepare('SELECT collection_id FROM acquisition_targets WHERE acquisition_id=?').all(id) as {collection_id:string}[];
      if (!targets.length || targets.some(t => !collections.some(collection => String(collection.id) === t.collection_id && collection.syncToKobo))) throw new Error('Choose an existing Kobo-enabled target collection before downloading.');
      const activities = await sm.activity();
      if (activities.some(a => a.id === release.source_id)) return attention(db, id, 'This release already has Shelfmark activity. Review it there; ShelfScout will not enqueue it again.');
      const baseline = (await bo.dockFiles()).map(file => file.id);
      const now = new Date(deps.now()).toISOString();
      const reserved = db.transaction(() => {
        if (db.prepare('SELECT acquisition_id FROM acquisition_flows WHERE release_id=? AND acquisition_id!=?').get(release.source_id, id)) return false;
        return !!db.prepare("UPDATE acquisition_flows SET release_id=?,release_source=?,download_attempted_at=?,phase='track_download',phase_started_at=?,library_id=?,folder_id=?,evidence_json=? WHERE acquisition_id=? AND download_attempted_at IS NULL").run(release.source_id, release.source, now, now, library, folder, JSON.stringify({ baselineDockIds: baseline }), id).changes;
      }).immediate();
      if (!reserved) return attention(db, id, 'Release is already reserved or being submitted. Recheck the existing acquisition; no duplicate was queued.');
      recordStatus(db, id, 'submitting_download', 'Submission intent saved. Waiting for Shelfmark activity confirmation.');
      try { await sm.download(release); }
      catch { recordStatus(db, id, 'submission_uncertain', 'Submission outcome unknown. Checking the saved Shelfmark source ID; no automatic repeat.'); }
      return true;
    }
    const evidence: Evidence = f.evidence_json ? JSON.parse(f.evidence_json) : { baselineDockIds: [] };
    if (f.phase === 'track_download' || f.phase === 'submit_download') {
      const activities = (await sm.activity()).filter(a => a.id === f.release_id);
      const activity = activities[0];
      if (activities.length > 1 || (activity && activity.source !== f.release_source)) return attention(db, id, 'Shelfmark source ID has conflicting activity. Review the saved release.');
      if (!activity) {
        if (deps.now() - Date.parse(f.download_attempted_at!) > 10 * 60_000) return attention(db, id, 'No activity confirms the saved submission after 10 minutes. Inspect Shelfmark history or resume that release manually, then Recheck. ShelfScout will not resubmit it.');
        return true;
      }
      if (!activity.added_time || activity.added_time * 1000 < Date.parse(f.download_attempted_at!) - 5000 || (evidence.taskAddedTime && evidence.taskAddedTime !== activity.added_time)) return attention(db, id, 'Shelfmark activity belongs to a different submission generation. Review its history before continuing.');
      evidence.taskAddedTime = activity.added_time;
      db.prepare('UPDATE acquisition_flows SET download_seen_at=?,evidence_json=? WHERE acquisition_id=?').run(new Date(deps.now()).toISOString(), JSON.stringify(evidence), id);
      if (['error', 'failed', 'cancelled'].includes(activity.state)) return attention(db, id, 'Shelfmark download failed or was cancelled. Review or resume the saved release in Shelfmark, then Recheck.');
      if (activity.state !== 'complete') { recordStatus(db, id, 'downloading', 'Shelfmark is downloading or delivering the selected release.'); return true; }
      if (!activity.download_path) return attention(db, id, 'Shelfmark completed without an existing folder file. Check folder output and Book Dock auto-finalization; no file will be guessed.');
      evidence.file = await deps.evidence(activity.download_path);
      db.prepare('UPDATE acquisition_flows SET evidence_json=? WHERE acquisition_id=?').run(JSON.stringify(evidence), id);
      phase(db, id, 'await_import', 'awaiting_import'); return true;
    }
    if (f.phase === 'await_import') {
      await validateDockSetup(bo);
      if (!evidence.file) throw new Error('Completed-file evidence is missing.');
      const current = await deps.evidence(evidence.file.path);
      if (!sameFile(evidence.file, current)) return attention(db, id, 'Completed file changed after delivery. Review it; saved evidence will not be replaced automatically.');
      if (deps.now() - Date.parse(evidence.file.observedAt) < 5000) return true;
      const matches = (await bo.dockFiles()).filter(file => file.fileName === evidence.file!.name);
      if (!matches.length) { await bo.rescan(); return true; }
      if (matches.length !== 1 || evidence.baselineDockIds.includes(matches[0].id)) return attention(db, id, 'Book Dock file is ambiguous or predates this submission. Review the incoming directory; no entry was finalized.');
      const file = await bo.dockFile(matches[0].id);
      if (file.status === 'error') return attention(db, id, 'Book Dock could not process the completed file. Repair the entry in BookOrbit, then Recheck.');
      if (file.status !== 'ready') return true;
      validateDockFile(c, file, current);
      const preview = await bo.previewImport(file.id, f.library_id!, f.folder_id!);
      if (preview.truncated || preview.items.length !== 1 || preview.items[0].fileId !== file.id || preview.items[0].status !== 'ready') return attention(db, id, 'Book Dock finalization preview is blocked, conflicting or duplicate. Review the exact entry and destination in BookOrbit, then Recheck.');
      // Re-read immediately before the one permitted finalize submission.
      validateDockFile(c, await bo.dockFile(file.id), await deps.evidence(evidence.file.path));
      const finalEvidence = await deps.evidence(evidence.file.path);
      if (!sameFile(current, finalEvidence)) throw new Error('Incoming file changed during import preview.');
      const reserved = db.prepare("UPDATE acquisition_flows SET dock_file_id=?,import_attempted_at=?,phase='import',phase_started_at=? WHERE acquisition_id=? AND import_attempted_at IS NULL").run(file.id, new Date(deps.now()).toISOString(), new Date(deps.now()).toISOString(), id).changes;
      if (!reserved) return true;
      recordStatus(db, id, 'importing', 'Verified Book Dock file submitted for import.');
      try {
        const result = await bo.finalizeImport(file.id, f.library_id!, f.folder_id!);
        const imported = result.results.find(r => r.fileId === file.id);
        if (!imported?.success || !Number.isSafeInteger(imported.bookId) || imported.bookId! < 1) return attention(db, id, 'Book Dock finalization failed or returned no book ID. Review that entry in BookOrbit; Recheck only reconciles, never repeats import.');
        setBook(db, id, imported.bookId!);
      } catch { recordStatus(db, id, 'importing', 'Import outcome unknown. Recovering by book identity and completed-file checksum; no repeat finalization.'); }
      return true;
    }
    if (f.phase === 'import') {
      const available = await bo.availability(c);
      if (available.ownedBookId) {
        // Identity is necessary but insufficient: read back the actual imported bytes.
        await verifyBook(bo, c, String(available.ownedBookId), f);
        setBook(db, id, available.ownedBookId); return true;
      }
      if (deps.now() - Date.parse(f.import_attempted_at!) > 10 * 60_000) return attention(db, id, 'No verified library book after import. Inspect the saved Book Dock file in BookOrbit and complete or repair its import there, then Recheck. Import will not be repeated automatically.');
      return true;
    }
    return attention(db, id, 'Unknown acquisition stage. Review saved acquisition data.');
  } catch (error) {
    // Adapters return sanitized errors, never upstream bodies, cookies or release URLs.
    const message = error instanceof Error && !('code' in error) ? error.message : 'Incoming file is unavailable. Check the shared directory, file permissions and completed delivery, then Recheck.';
    return attention(db, id, message);
  }
}
