import type Database from 'better-sqlite3';
import path from 'node:path';
import { acquisition, flow, normalizeStatus, recordStatus, type Acquisition, type Flow, type AcquisitionEvidence as Evidence } from './acquisition';
import { BookOrbitClient, type BookCandidate, type DockFile } from './bookorbit';
import { ShelfmarkClient, type Release } from './shelfmark';
import { metadataMatches, releaseAssessment } from './acquisition-identity';
import { checkIncomingDirectory, incomingEvidence, sameFile, type FileEvidence } from './acquisition-files';

function sameSubmissionTime(saved: number, current: number) {
  // Shelfmark exposes time.time() for active tasks, but persists queued_at with
  // seconds precision. Terminal snapshot/history entries therefore lose fractions.
  // Retain exact comparison when both timestamps still carry that precision.
  return saved === current || ((Number.isInteger(saved) || Number.isInteger(current)) && Math.floor(saved) === Math.floor(current));
}
export interface AcquisitionAdapters { bo: BookOrbitClient; shelfmark: () => ShelfmarkClient; evidence: typeof incomingEvidence; now: () => number; }
const candidateFor = (row: Acquisition): BookCandidate => ({ title: row.title, author: row.author, isbn13: row.isbn13, language: row.language });
function attention(db: Database.Database, id: string, detail: string) { recordStatus(db, id, 'needs_attention', detail); return false; }
function phase(db: Database.Database, id: string, value: string, status = value) {
  db.prepare('UPDATE acquisition_flows SET phase=?,phase_started_at=? WHERE acquisition_id=?').run(value, new Date().toISOString(), id);
  recordStatus(db, id, status, status.replaceAll('_', ' '));
}
function setBook(db: Database.Database, id: string, bookId: number) {
  db.prepare('UPDATE acquisitions SET upstream_book_id=? WHERE id=?').run(String(bookId), id);
  db.prepare("UPDATE acquisition_flows SET evidence_json=json_remove(evidence_json,'$.retryRequestedAt') WHERE acquisition_id=?").run(id);
  phase(db, id, 'available', 'available_in_bookorbit');
}
async function verifyBook(bo: BookOrbitClient, c: BookCandidate, bookId: string, f?: Flow) {
  const book = await bo.book(bookId);
  if (!metadataMatches(c, book)) throw new Error('BookOrbit identity does not match the requested title, author, language and ISBN. Review its metadata.');
  const files = Array.isArray(book.files) ? book.files as { id: number; format: string; sizeBytes: number }[] : [];
  const epubs = files.filter(file => file.format?.toLowerCase() === 'epub');
  if (!epubs.length) throw new Error('BookOrbit has no verified EPUB for this book.');
  const evidence = f?.evidence_json ? JSON.parse(f.evidence_json) as Evidence : undefined;
  if (evidence?.file) {
    if (book.libraryId !== f?.library_id) throw new Error('Imported book is in a different library. Review the Book Dock target.');
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
function downloadDestination() {
  const required = ['BOOKORBIT_LIBRARY_ID', 'BOOKORBIT_FOLDER_ID', 'BOOKORBIT_DOCK_DIR', 'SHELFMARK_OUTPUT_DIR', 'SHELFSCOUT_INCOMING_DIR'];
  const missing = required.filter(key => !process.env[key]?.trim());
  if (missing.length) throw new Error(`Download setup is incomplete. Set ${missing.join(', ')} in the ShelfScout worker environment, restart the worker, then Recheck. The incoming folder must expose the same files as Shelfmark output and BookOrbit Book Dock; see docs/integrations.md.`);
  const library = Number(process.env.BOOKORBIT_LIBRARY_ID), folder = Number(process.env.BOOKORBIT_FOLDER_ID);
  if (!Number.isSafeInteger(library) || library < 1 || !Number.isSafeInteger(folder) || folder < 1) throw new Error('BOOKORBIT_LIBRARY_ID and BOOKORBIT_FOLDER_ID must be positive integer IDs for the final BookOrbit library and its folder.');
  const invalidPaths = ['BOOKORBIT_DOCK_DIR', 'SHELFMARK_OUTPUT_DIR'].filter(key => !path.posix.isAbsolute(process.env[key]!));
  if (!path.isAbsolute(process.env.SHELFSCOUT_INCOMING_DIR!)) invalidPaths.push('SHELFSCOUT_INCOMING_DIR');
  if (invalidPaths.length) throw new Error(`Use absolute folder paths for ${invalidPaths.join(', ')}. Each path is relative to its own service and must map to the same shared incoming directory.`);
  return { library, folder };
}
function validateDockFile(c: BookCandidate, file: DockFile, evidence: FileEvidence) {
  if (file.status !== 'ready' || file.fileName !== evidence.name || file.fileSize !== evidence.size || file.format?.toLowerCase() !== 'epub' || !Array.isArray(file.unitFiles) || file.unitFiles.length) throw new Error('Book Dock file evidence changed or represents a multi-file unit. Review this entry.');
  if (!metadataMatches(c, file.embeddedMetadata)) throw new Error('Embedded EPUB metadata does not match the requested title, author, language and ISBN. Review this file before import.');
  // BookOrbit's public finalize API uses selectedMetadata ?? embeddedMetadata.
  // A ready file without manual metadata selection is valid; fetched metadata
  // and its confidence score do not replace this API's effective metadata.
  if (!metadataMatches(c, file.selectedMetadata ?? file.embeddedMetadata)) throw new Error('Selected Book Dock metadata does not match the requested title, author, language and ISBN. Review this file before import.');
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
/** Background recovery for blocked downloads/imports. Never resumes a failed phase. */
export async function reconcileOwnedAcquisition(db: Database.Database, id: string, bo?: BookOrbitClient): Promise<boolean> {
  const row = acquisition(db, id), f = flow(db, id);
  if (!row || row.status !== 'needs_attention' || row.upstream_book_id || !f || !['track_download', 'await_import', 'import'].includes(f.phase)) return false;
  try {
    const client = bo || new BookOrbitClient();
    const candidate = JSON.parse(f.candidate_json) as BookCandidate;
    const available = await client.availability(candidate);
    if (!available.ownedBookId) return false;
    await verifyBook(client, candidate, String(available.ownedBookId), f);
    setBook(db, id, available.ownedBookId);
    return true;
  } catch {
    // Keep the actionable failure visible. A periodic ownership lookup must not
    // replace it with transient connectivity errors or repeat download/import work.
    return false;
  }
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
    if (f.phase === 'track_download' || f.phase === 'await_import') {
      // Book Dock can be finalized externally, removing the incoming file. Check
      // the library before depending on Shelfmark's path or the watched directory.
      const available = await bo.availability(c);
      if (available.ownedBookId) {
        await verifyBook(bo, c, String(available.ownedBookId), f);
        setBook(db, id, available.ownedBookId);
        return true;
      }
    }
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
      const { library, folder } = downloadDestination();
      await validateDockSetup(bo);
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
      const retryRequested = !!evidence.retryRequestedAt;
      if (retryRequested) {
        delete evidence.retryRequestedAt;
        db.prepare('UPDATE acquisition_flows SET evidence_json=? WHERE acquisition_id=?').run(JSON.stringify(evidence), id);
      }
      const activities = (await sm.activity()).filter(a => a.id === f.release_id);
      const activity = activities[0];
      if (activities.length > 1 || (activity && activity.source !== f.release_source)) return attention(db, id, 'Shelfmark source ID has conflicting activity. Review the saved release.');
      if (!activity) {
        if (deps.now() - Date.parse(f.download_attempted_at!) > 10 * 60_000) return attention(db, id, 'No activity confirms the saved submission after 10 minutes. Inspect Shelfmark history or resume that release manually, then Recheck. ShelfScout will not resubmit it.');
        return true;
      }
      if (typeof activity.added_time !== 'number' || !Number.isFinite(activity.added_time) || activity.added_time <= 0) return attention(db, id, 'Shelfmark activity has no valid submission timestamp. Review its history before continuing.');
      if (activity.added_time * 1000 < Date.parse(f.download_attempted_at!) - 5000) return attention(db, id, 'Shelfmark activity predates this submission. Review its history and check that both servers have synchronized clocks.');
      const active = ['queued', 'resolving', 'locating', 'downloading'].includes(activity.state);
      const failed = ['error', 'failed', 'cancelled'].includes(activity.state);
      if (evidence.taskAddedTime !== undefined && !sameSubmissionTime(evidence.taskAddedTime, activity.added_time)) {
        const retry = evidence.retry;
        // In-memory retries reuse added_time. Restored tasks get a fresh time,
        // while persisted terminal activity can still use the original queued_at.
        const expectedRetry = retry && (retry.activeAddedTime !== undefined
          ? sameSubmissionTime(retry.activeAddedTime, activity.added_time)
          : (active || activity.state === 'complete' || retry.confirmed) && activity.added_time * 1000 >= Date.parse(retry.attemptedAt) - 5000 && activity.added_time * 1000 <= deps.now() + 5000);
        if (!expectedRetry) return attention(db, id, 'Shelfmark activity belongs to a different submission generation. Review its history before continuing.');
        retry!.activeAddedTime ??= activity.added_time;
      }
      // Keep the first observation; replacing it with a rounded value would lose
      // evidence needed to reject a later, different fractional timestamp.
      evidence.taskAddedTime ??= activity.added_time;
      if (evidence.retry && !evidence.retry.confirmed) {
        // A transition out of the saved failure proves the retry took effect even
        // after a lost response. An unchanged failure cannot prove another attempt.
        if (active || activity.state === 'complete') evidence.retry.confirmed = true;
        else {
          if (deps.now() - Date.parse(evidence.retry.attemptedAt) > 10 * 60_000) return attention(db, id, 'Shelfmark retry outcome is still uncertain. Review the saved download in Shelfmark, then Recheck. Another retry will not be sent without evidence that the previous one took effect.');
          return true;
        }
      }
      db.prepare('UPDATE acquisition_flows SET download_seen_at=?,evidence_json=? WHERE acquisition_id=?').run(new Date(deps.now()).toISOString(), JSON.stringify(evidence), id);
      if (failed) {
        if (retryRequested && activity.retry_available === true && !f.import_attempted_at) {
          downloadDestination();
          await validateDockSetup(bo);
          await checkIncomingDirectory();
          const available = await bo.availability(c);
          if (available.ownedBookId) { setBook(db, id, available.ownedBookId); return true; }
          if (available.existingRequestId) return attention(db, id, 'BookOrbit already has a request for this book. Review that request before retrying the Shelfmark download.');
          const collections = await bo.collections();
          const targets = db.prepare('SELECT collection_id FROM acquisition_targets WHERE acquisition_id=?').all(id) as { collection_id: string }[];
          if (!targets.length || targets.some(t => !collections.some(collection => String(collection.id) === t.collection_id && collection.syncToKobo))) return attention(db, id, 'Choose an existing Kobo-enabled target collection before retrying.');
          const baselineDockIds = (await bo.dockFiles()).map(file => file.id);
          const savedEvidence = JSON.stringify(evidence);
          const attemptedAt = new Date(deps.now()).toISOString();
          evidence.baselineDockIds = baselineDockIds;
          delete evidence.file;
          evidence.retry = { attemptedAt, confirmed: false };
          // Reserve this explicit retry before POST. Worker restarts and duplicate
          // jobs reconcile it instead of repeating a possibly accepted request.
          const reservedEvidence = JSON.stringify(evidence);
          const reserved = db.prepare("UPDATE acquisition_flows SET evidence_json=?,phase_started_at=? WHERE acquisition_id=? AND evidence_json=? AND import_attempted_at IS NULL AND phase='track_download'").run(reservedEvidence, attemptedAt, id, savedEvidence).changes;
          if (!reserved) return true;
          recordStatus(db, id, 'submitting_download', 'Explicit retry of the saved Shelfmark download recorded.');
          try {
            await sm.retryDownload(activity.id);
            evidence.retry.confirmed = true;
            db.prepare('UPDATE acquisition_flows SET evidence_json=? WHERE acquisition_id=? AND evidence_json=?').run(JSON.stringify(evidence), id, reservedEvidence);
            recordStatus(db, id, 'downloading', 'Shelfmark accepted the explicit download retry.');
          } catch { recordStatus(db, id, 'submission_uncertain', 'Retry outcome unknown. Checking saved Shelfmark activity; the retry will not be repeated automatically.'); }
          return true;
        }
        return attention(db, id, activity.retry_available === true ? 'Shelfmark download failed or was cancelled. Fix the issue in Shelfmark, then use Recheck / retry download to retry the saved release once.' : 'Shelfmark download failed or was cancelled and does not offer a retry for this release. Review it in Shelfmark, then Recheck.');
      }
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
