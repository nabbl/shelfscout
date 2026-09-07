import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase } from '../src/lib/db';
import { acquisition, flow, publicAcquisitions, recoverAcquisitions, submitAcquisition, updateAcquisition } from '../src/lib/acquisition';
import { reconcileAcquisition } from '../src/lib/acquisition-worker';
import { BookOrbitClient } from '../src/lib/bookorbit';
import { ShelfmarkClient } from '../src/lib/shelfmark';
import { incomingEvidence } from '../src/lib/acquisition-files';
import { claimJob } from '../src/lib/jobs';
import { metadataMatches, releaseAssessment } from '../src/lib/acquisition-identity';

const candidate = { title: 'A Fixture Book', author: 'Test Writer', isbn13: '9780306406157', language: 'eng' };
const metadata = { title: candidate.title, authors: [candidate.author], isbn13: candidate.isbn13, language: 'en' };
const release = { source: 'direct_download', source_id: 'fixture-release-123', title: candidate.title, language: 'en', format: 'epub', content_type: 'ebook', extra: { author: candidate.author, isbn13: candidate.isbn13 } };
const cleanups: (() => void)[] = [];
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); cleanups.splice(0).forEach(fn => fn()); });
function setup(persist = false) {
  const dir = mkdtempSync(join(tmpdir(), 'shelfscout-acquire-'));
  const incoming = join(dir, 'incoming');
  // Keep DB separate from the read-only incoming mount.
  mkdirSync(incoming);
  const bytes = readFileSync('tests/fixtures/acquisition.epub');
  writeFileSync(join(incoming, 'fixture.epub'), bytes);
  for (const [key, value] of Object.entries({ BOOKORBIT_URL: 'http://bookorbit.test/base', BOOKORBIT_TOKEN: 'secret-token', SHELFMARK_URL: 'http://shelfmark.test/base', SHELFMARK_COOKIE: 'session=secret-cookie', SHELFMARK_OUTPUT_DIR: '/books', SHELFSCOUT_INCOMING_DIR: incoming, BOOKORBIT_DOCK_DIR: '/book-dock', BOOKORBIT_LIBRARY_ID: '4', BOOKORBIT_FOLDER_ID: '5' })) vi.stubEnv(key, value);
  const dbPath = persist ? join(dir, 'test.sqlite') : ':memory:';
  const h = {
    db: createDatabase(dbPath), dbPath, incoming, bytes, id: '', now: Date.now(),
    owned: null as number | null, existingRequest: null as number | null, releases: [structuredClone(release)], activity: [] as Record<string, unknown>[], history: [] as Record<string, unknown>[],
    dock: [] as Record<string, unknown>[], members: [] as number[], collections: [{ id: 12, name: 'Kobo', syncToKobo: true }],
    book: { id: 91, libraryId: 4, ...metadata, files: [{ id: 201, format: 'epub', sizeBytes: bytes.length }] },
    previewStatus: 'ready', finalizeFailure: false, downloadTimeout: false, importTimeout: false, collectionTimeout: false, membershipFailure: false, corruptImported: false,
    autoFinalize: false, downloadPosts: 0, importPosts: 0, collectionPosts: 0,
    dockFile: () => ({ id: 71, fileName: 'fixture.epub', fileSize: bytes.length, format: 'epub', status: 'ready', embeddedMetadata: structuredClone(metadata), selectedMetadata: structuredClone(metadata), unitFiles: [] }),
  };
  cleanups.push(() => { if (h.db.open) h.db.close(); rmSync(dir, { recursive: true, force: true }); });
  const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
    const url = new URL(input), p = url.pathname.replace('/base', '');
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
    if (p === '/api/v1/book-requests/availability') return json([{ ownedBookId: h.owned, existingRequestId: h.existingRequest }]);
    if (p.startsWith('/api/v1/book-requests/')) return json({ id: 41, status: h.owned ? 'available' : 'approved', matchedBookId: h.owned });
    if (p === '/api/v1/books/91') return json(h.book);
    if (p === '/api/v1/books/files/201/download') return new Response(h.corruptImported ? new Uint8Array(h.bytes.length) : h.bytes);
    if (p === '/api/v1/collections') return json(h.collections);
    if (/\/collections\/\d+\/books$/.test(p)) {
      if (init?.method === 'POST') { h.collectionPosts++; if (!h.membershipFailure) h.members.push(91); if (h.collectionTimeout) throw new Error('network error with secret-token'); return json({}); }
      const page = Number(url.searchParams.get('page'));
      return json({ items: h.members.slice(page * 100, (page + 1) * 100).map(id => ({ id })), total: h.members.length });
    }
    if (p === '/api/v1/book-dock/settings') return json({ bookDockPath: '/book-dock', autoFinalizeEnabled: h.autoFinalize });
    if (p === '/api/v1/book-dock/files') return json({ items: h.dock, total: h.dock.length });
    if (p === '/api/v1/book-dock/files/71') return json(h.dock.find(x => x.id === 71));
    if (p === '/api/v1/book-dock/rescan') return new Response(null, { status: 204 });
    if (p === '/api/v1/book-dock/finalize/preview') { expect(JSON.parse(String(init?.body))).toEqual({ fileIds: [71], overrides: [{ fileId: 71, libraryId: 4, folderId: 5 }] }); return json({ truncated: false, items: [{ fileId: 71, status: h.previewStatus }] }); }
    if (p === '/api/v1/book-dock/finalize') {
      h.importPosts++; if (h.finalizeFailure) return json({ results: [{ fileId: 71, success: false }] });
      h.owned = 91; h.dock = []; if (h.importTimeout) throw new Error('lost response');
      return json({ results: [{ fileId: 71, success: true, bookId: 91 }] });
    }
    if (p === '/api/releases') return json({ releases: h.releases });
    if (p === '/api/releases/download') {
      h.downloadPosts++;
      h.activity = [{ id: release.source_id, source: release.source, added_time: Date.parse(flow(h.db, h.id)!.download_attempted_at!) / 1000, state: 'downloading' }];
      if (h.downloadTimeout) throw new Error('lost response secret-cookie');
      return json({ status: 'queued', priority: 0 });
    }
    if (p === '/api/activity/snapshot') {
      const status: Record<string, Record<string, unknown>> = {};
      for (const item of h.activity) (status[String(item.state)] ??= {})[String(item.id)] = item;
      return json({ status });
    }
    if (p === '/api/activity/history') return json(Number(url.searchParams.get('offset')) === 0 ? h.history : []);
    throw new Error(`Unexpected test API ${p}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  async function start() { const result = await submitAcquisition(h.db, candidate, '12'); h.id = result.acquisition!.id; return result; }
  async function step() { h.now += 6000; return reconcileAcquisition(h.db, h.id, { bo: new BookOrbitClient(), shelfmark: () => new ShelfmarkClient(), evidence: incomingEvidence, now: () => h.now }); }
  async function queueDownload() { await start(); await step(); await step(); await step(); expect(h.downloadPosts).toBe(1); }
  async function deliver() { h.activity[0] = { ...h.activity[0], state: 'complete', download_path: '/books/fixture.epub' }; h.dock = [h.dockFile()]; await step(); }
  return { h, fetchMock, start, step, queueDownload, deliver };
}
describe('Shelfmark → Book Dock → Kobo lifecycle', () => {
  it('reports all missing destination settings before upstream checks and can resume after configuration', async () => {
    const { h, start, step, fetchMock } = setup();
    await start(); await step(); await step();
    vi.stubEnv('BOOKORBIT_LIBRARY_ID', '');
    vi.stubEnv('SHELFSCOUT_INCOMING_DIR', '');
    fetchMock.mockClear();
    await step();
    const error = acquisition(h.db, h.id)!.last_error;
    expect(error).toContain('Set BOOKORBIT_LIBRARY_ID, SHELFSCOUT_INCOMING_DIR');
    expect(error).not.toContain('BOOKORBIT_FOLDER_ID');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(flow(h.db, h.id)!.download_attempted_at).toBeNull();
    vi.stubEnv('BOOKORBIT_LIBRARY_ID', '4');
    vi.stubEnv('SHELFSCOUT_INCOMING_DIR', h.incoming);
    updateAcquisition(h.db, h.id, 'recheck');
    await step(); expect(h.downloadPosts).toBe(1);
  });
  it.each([
    ['BOOKORBIT_FOLDER_ID', '1.5', 'positive integer IDs'],
    ['BOOKORBIT_DOCK_DIR', '', 'Set BOOKORBIT_DOCK_DIR'],
    ['SHELFMARK_OUTPUT_DIR', 'books', 'absolute folder paths for SHELFMARK_OUTPUT_DIR'],
  ])('rejects invalid %s before recording a download attempt', async (key, value, message) => {
    const { h, start, step, fetchMock } = setup();
    await start(); await step(); await step();
    vi.stubEnv(key, value); fetchMock.mockClear();
    await step();
    expect(acquisition(h.db, h.id)!.last_error).toContain(message);
    expect(flow(h.db, h.id)!.download_attempted_at).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('persists atomic intent, deduplicates concurrent clicks, verifies ownership before download', async () => {
    const { h, fetchMock, step } = setup(); h.owned = 91;
    const results = await Promise.all(Array.from({ length: 12 }, () => submitAcquisition(h.db, candidate, '12')));
    h.id = results[0].acquisition!.id;
    expect(new Set(results.map(r => r.acquisition!.id)).size).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.db.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 1 });
    await step(); expect(acquisition(h.db, h.id)!.status).toBe('available_in_bookorbit');
    await step(); expect(acquisition(h.db, h.id)!.status).toBe('ready_for_kobo');
    expect(h.downloadPosts).toBe(0); expect(h.collectionPosts).toBe(1);
  });
  it('completes download, stable file correlation, preview, import checksum and membership', async () => {
    const { h, queueDownload, deliver, step, fetchMock } = setup();
    await queueDownload(); await step(); expect(acquisition(h.db, h.id)!.status).toBe('downloading');
    await deliver(); expect(acquisition(h.db, h.id)!.status).toBe('awaiting_import');
    await step(); expect(acquisition(h.db, h.id)!.status).toBe('available_in_bookorbit');
    await step(); expect(acquisition(h.db, h.id)!.status).toBe('ready_for_kobo');
    expect(h.importPosts).toBe(1); expect(h.downloadPosts).toBe(1);
    expect(fetchMock.mock.calls.some(([url, init]) => new URL(url).pathname.endsWith('/book-requests') && init?.method === 'POST')).toBe(false);
    expect(JSON.stringify(publicAcquisitions(h.db))).not.toMatch(/secret-token|secret-cookie|download_url/);
  });
  it('requires explicit release choice for multiple or incomplete edition matches and rejects forged choices', async () => {
    const { h, start, step } = setup(); h.releases.push({ ...release, source_id: 'another' });
    await start(); await step(); await step();
    expect(acquisition(h.db, h.id)!.status).toBe('needs_attention'); expect(h.downloadPosts).toBe(0);
    expect(() => updateAcquisition(h.db, h.id, 'select_release', 99)).toThrow();
    updateAcquisition(h.db, h.id, 'select_release', 0); await step();
    expect(h.downloadPosts).toBe(1); expect(() => updateAcquisition(h.db, h.id, 'select_release', 1)).toThrow();
  });
  it('never selects the wrong language, edition, title, or format and does not auto-pick unknown ISBN', () => {
    for (const r of [{ ...release, language: 'de' }, { ...release, title: 'Another Book' }, { ...release, format: 'pdf' }, { ...release, extra: { ...release.extra, isbn13: '9780000000002' } }]) expect(releaseAssessment(candidate, r).selectable).toBe(false);
    expect(releaseAssessment(candidate, { ...release, extra: { author: candidate.author } })).toMatchObject({ selectable: true, exact: false });
    expect(metadataMatches(candidate, { ...metadata, language: null })).toBe(false);
    expect(metadataMatches(candidate, { ...metadata, isbn13: null })).toBe(false);
  });
  it('confirms co-author credits explicitly and verifies reordered metadata through import', async () => {
    const { h, start, step, deliver } = setup();
    h.releases[0].extra.author = 'Writer, Test; Collaborator, Another';
    h.releases[0].content_type = '📕 book (fiction)';
    h.book.authors = ['Writer, Test', 'Collaborator, Another'];
    const originalDockFile = h.dockFile;
    h.dockFile = () => {
      const file = originalDockFile();
      file.embeddedMetadata.authors = ['Writer, Test; Collaborator, Another'];
      file.selectedMetadata.authors = ['Writer, Test', 'Collaborator, Another'];
      return file;
    };
    await start(); await step(); await step();
    expect(acquisition(h.db, h.id)!.status).toBe('needs_attention');
    expect(publicAcquisitions(h.db)[0].releases[0].selectable).toBe(true);
    expect(h.downloadPosts).toBe(0);
    updateAcquisition(h.db, h.id, 'select_release', 0);
    await step(); await step(); await deliver(); await step(); await step();
    expect(acquisition(h.db, h.id)!.status).toBe('ready_for_kobo');
    expect(h.downloadPosts).toBe(1); expect(h.importPosts).toBe(1);
  });
  it('reconciles a download timeout by durable source ID across database reopen without resubmitting', async () => {
    const { h, queueDownload, step, deliver } = setup(true); h.downloadTimeout = true;
    await queueDownload(); expect(acquisition(h.db, h.id)!.status).toBe('submission_uncertain');
    const job = claimJob(h.db)!; h.db.close(); h.db = createDatabase(h.dbPath);
    expect(claimJob(h.db)).toBeUndefined();
    expect(claimJob(h.db, new Date(Date.now() + 121000).toISOString())!.id).toBe(job.id);
    await step(); expect(acquisition(h.db, h.id)!.status).toBe('downloading');
    await deliver(); await step(); await step(); expect(h.downloadPosts).toBe(1); expect(h.importPosts).toBe(1);
  });
  it('does not resubmit after a crash between intent persistence and the HTTP call', async () => {
    const { h, start, step } = setup(); await start(); await step(); await step();
    h.db.prepare("UPDATE acquisition_flows SET phase='track_download',release_id=?,release_source=?,download_attempted_at=?,evidence_json=? WHERE acquisition_id=?").run(release.source_id,release.source,new Date().toISOString(),JSON.stringify({baselineDockIds:[]}),h.id);
    h.now += 11 * 60_000;
    await step(); expect(acquisition(h.db, h.id)!.status).toBe('needs_attention');
    updateAcquisition(h.db, h.id, 'recheck'); await step(); expect(h.downloadPosts).toBe(0);
  });
  it('recovers dismissed completed activity from history', async () => {
    const { h, queueDownload, step } = setup(); await queueDownload();
    h.history = [{ item_type: 'download', final_status: 'complete', snapshot: { download: { ...h.activity[0], download_path: '/books/fixture.epub' } } }]; h.activity = [];
    await step(); expect(acquisition(h.db, h.id)!.status).toBe('awaiting_import');
  });
  it.each(['error', 'cancelled'])('surfaces a %s download without retrying', async state => {
    const { h, queueDownload, step } = setup(); await queueDownload(); h.activity[0].state = state;
    await step(); expect(acquisition(h.db, h.id)!.status).toBe('needs_attention'); expect(h.importPosts).toBe(0); expect(h.downloadPosts).toBe(1);
  });
  it('accepts Shelfmark whole-second persisted activity after observing a fractional active timestamp across restart', async () => {
    const { h, queueDownload, step, deliver } = setup(true);
    await queueDownload();
    const addedTime = Math.floor(Number(h.activity[0].added_time)) + 0.678;
    h.activity[0].added_time = addedTime;
    await step();
    // An acquisition stopped by the previous exact comparison can use Recheck
    // after upgrading; its saved timestamp and attempt marker remain intact.
    h.db.prepare("UPDATE acquisitions SET status='needs_attention',last_error='Shelfmark activity belongs to a different submission generation.' WHERE id=?").run(h.id);
    h.db.close(); h.db = createDatabase(h.dbPath);
    updateAcquisition(h.db, h.id, 'recheck');
    h.activity[0].added_time = Math.floor(addedTime);
    await deliver();
    expect(acquisition(h.db, h.id)!.status).toBe('awaiting_import');
    expect(JSON.parse(flow(h.db, h.id)!.evidence_json!).taskAddedTime).toBe(addedTime);
    await step(); await step();
    expect(acquisition(h.db, h.id)!.status).toBe('ready_for_kobo');
    expect(h.downloadPosts).toBe(1); expect(h.importPosts).toBe(1);
  });
  it('surfaces download failure after Shelfmark rounds the timestamp in persisted history', async () => {
    const { h, queueDownload, step } = setup(); await queueDownload();
    const addedTime = Math.floor(Number(h.activity[0].added_time)) + 0.678;
    h.activity[0].added_time = addedTime; await step();
    h.history = [{ item_type: 'download', final_status: 'error', snapshot: { download: { ...h.activity[0], added_time: Math.floor(addedTime) } } }];
    h.activity = [];
    await step();
    expect(acquisition(h.db, h.id)!.last_error).toContain('download failed or was cancelled');
    expect(h.downloadPosts).toBe(1); expect(h.importPosts).toBe(0);
  });
  it.each(['older', 'newer', 'different-fraction', 'missing'])('rejects %s submission timestamps without importing or redownloading', async kind => {
    const { h, queueDownload, step } = setup(); await queueDownload();
    const addedTime = Math.floor(Number(h.activity[0].added_time)) + 0.4;
    h.activity[0].added_time = addedTime;
    if (kind !== 'older') await step();
    h.activity[0].added_time = kind === 'older' ? addedTime - 60 : kind === 'newer' ? Math.floor(addedTime) + 1 : kind === 'different-fraction' ? addedTime + 0.1 : undefined;
    await step();
    expect(acquisition(h.db, h.id)!.status).toBe('needs_attention');
    expect(h.downloadPosts).toBe(1); expect(h.importPosts).toBe(0);
  });
  it('retains fractional evidence after a whole-second observation', async () => {
    const { h, queueDownload, step } = setup(); await queueDownload();
    const addedTime = Math.floor(Number(h.activity[0].added_time)) + 0.4;
    h.activity[0].added_time = addedTime; await step();
    h.activity[0].added_time = Math.floor(addedTime); await step();
    expect(acquisition(h.db, h.id)!.status).toBe('downloading');
    h.activity[0].added_time = addedTime + 0.1; await step();
    expect(acquisition(h.db, h.id)!.last_error).toContain('different submission generation');
    expect(h.downloadPosts).toBe(1); expect(h.importPosts).toBe(0);
  });
  it('rejects reused source IDs from another source', async () => {
    const { h, queueDownload, step } = setup(); await queueDownload(); h.activity[0].source = 'another-source';
    await step(); expect(acquisition(h.db, h.id)!.status).toBe('needs_attention'); expect(h.importPosts).toBe(0);
  });
  it('does not import a partial download even if Book Dock already calls it ready', async () => {
    const { h, queueDownload, step } = setup(); await queueDownload(); h.dock = [h.dockFile()];
    await step(); expect(acquisition(h.db, h.id)!.status).toBe('downloading'); expect(h.importPosts).toBe(0);
  });
  it.each(['unrelated', 'duplicate', 'metadata', 'size', 'changed', 'pending'])('does not finalize %s file evidence', async kind => {
    const { h, queueDownload, deliver, step } = setup(); await queueDownload(); await deliver();
    if (kind === 'unrelated') h.dock[0].fileName = 'newest-other.epub';
    if (kind === 'duplicate') h.dock.push({ ...h.dockFile(), id: 72 });
    if (kind === 'metadata') h.dock[0].embeddedMetadata = { ...metadata, isbn13: '9780000000002' };
    if (kind === 'size') h.dock[0].fileSize = 3;
    if (kind === 'changed') writeFileSync(join(h.incoming, 'fixture.epub'), 'changed content');
    if (kind === 'pending') h.dock[0].status = 'extracting';
    await step(); expect(h.importPosts).toBe(0);
  });
  it('refuses a dock item present before the submission', async () => {
    const { h, queueDownload, deliver, step } = setup(); h.dock = [h.dockFile()];
    await queueDownload(); await deliver(); await step(); expect(h.importPosts).toBe(0); expect(acquisition(h.db, h.id)!.status).toBe('needs_attention');
  });
  it('waits for watcher delivery and handles a 204 rescan', async () => {
    const { h, queueDownload, deliver, step } = setup(); await queueDownload(); await deliver(); h.dock = [];
    expect(await step()).toBe(true); expect(acquisition(h.db, h.id)!.status).toBe('awaiting_import');
    h.dock = [h.dockFile()]; await step(); expect(h.importPosts).toBe(1);
  });
  it.each(['destination_conflict', 'duplicate', 'access_denied'])('stops a %s finalization preview', async status => {
    const { h, queueDownload, deliver, step } = setup(); await queueDownload(); await deliver(); h.previewStatus = status;
    await step(); expect(h.importPosts).toBe(0); expect(acquisition(h.db, h.id)!.status).toBe('needs_attention');
  });
  it('recovers a lost finalize response by identity and checksum without repeating import', async () => {
    const { h, queueDownload, deliver, step } = setup(true); h.importTimeout = true;
    await queueDownload(); await deliver(); await step(); expect(acquisition(h.db, h.id)!.status).toBe('importing');
    h.db.close(); h.db = createDatabase(h.dbPath); await step(); await step();
    expect(acquisition(h.db, h.id)!.status).toBe('ready_for_kobo'); expect(h.importPosts).toBe(1);
  });
  it('stops on import failure and rechecks without repeating finalize', async () => {
    const { h, queueDownload, deliver, step } = setup(); h.finalizeFailure = true;
    await queueDownload(); await deliver(); await step(); expect(acquisition(h.db, h.id)!.status).toBe('needs_attention');
    updateAcquisition(h.db, h.id, 'recheck'); await step(); expect(h.importPosts).toBe(1); expect(h.collectionPosts).toBe(0);
  });
  it('rejects an imported book with the same metadata but different file bytes', async () => {
    const { h, queueDownload, deliver, step } = setup(); h.corruptImported = true;
    await queueDownload(); await deliver(); await step(); await step();
    expect(acquisition(h.db, h.id)!.status).toBe('needs_attention'); expect(h.collectionPosts).toBe(0);
  });
  it('recovers lost collection responses with a read before write', async () => {
    const { h, start, step } = setup(); h.owned = 91; h.collectionTimeout = true;
    await start(); await step(); await step(); expect(acquisition(h.db, h.id)!.status).toBe('needs_attention');
    updateAcquisition(h.db, h.id, 'recheck'); await step(); expect(acquisition(h.db, h.id)!.status).toBe('ready_for_kobo'); expect(h.collectionPosts).toBe(1);
  });
  it('checks membership beyond the first page and rejects collections no longer Kobo-enabled', async () => {
    const { h, start, step } = setup(); h.owned = 91; h.members = [...Array.from({ length: 110 }, (_, i) => 1000 + i), 91];
    await start(); await step(); await step(); expect(h.collectionPosts).toBe(0); expect(acquisition(h.db, h.id)!.status).toBe('ready_for_kobo');
    h.collections.push({ id: 13, name: 'Unsynced', syncToKobo: false }); await submitAcquisition(h.db, candidate, '13'); await step();
    expect(acquisition(h.db, h.id)!.status).toBe('needs_attention'); expect(h.downloadPosts).toBe(0);
  });
  it('does not claim readiness when membership read-back fails', async () => {
    const { h, start, step } = setup(); h.owned = 91; h.membershipFailure = true;
    await start(); await step(); await step(); expect(acquisition(h.db, h.id)!.status).toBe('needs_attention');
  });
  it('retains and recovers legacy request records without creating new requests', async () => {
    const { h, step } = setup(); const now = new Date().toISOString(); h.id = 'legacy';
    h.db.prepare('INSERT INTO acquisitions(id,work_key,edition_key,title,author,isbn13,language,preferred_formats_json,status,upstream_request_id,created_at,updated_at,target_collection_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(h.id, 'legacy-work', 'legacy-edition', candidate.title, candidate.author, candidate.isbn13, 'eng', '["epub"]', 'requested_waiting_approval', '41', now, now, '12');
    recoverAcquisitions(h.db); expect(h.db.prepare('SELECT count(*) n FROM jobs').get()).toEqual({ n: 1 });
    expect(flow(h.db, h.id)).toBeUndefined(); await step(); expect(acquisition(h.db, h.id)!.status).toBe('searching_selecting');
    h.owned = 91; await step(); await step(); expect(acquisition(h.db, h.id)!.status).toBe('ready_for_kobo'); expect(h.downloadPosts).toBe(0);
  });
  it('keeps distinct languages and explicit editions separate while normalizing language aliases', async () => {
    const { h, start } = setup(); await start();
    const alias = await submitAcquisition(h.db, {...candidate,language:'en'},'12'); expect(alias.acquisition!.id).toBe(h.id);
    const otherEdition = await submitAcquisition(h.db, {...candidate,isbn13:'9780000000002'},'12'); expect(otherEdition.acquisition!.id).not.toBe(h.id);
    const otherLanguage = await submitAcquisition(h.db, {...candidate,language:'de'},'12'); expect(otherLanguage.acquisition!.id).not.toBe(h.id);
  });
  it('serializes duplicate legacy jobs and retains a newly selected collection after job completion', async () => {
    const { h, start, step } = setup(); h.owned=91; await start(); await step();
    const job=claimJob(h.db)!;
    await step(); expect(acquisition(h.db,h.id)!.status).toBe('ready_for_kobo');
    h.collections.push({id:13,name:'Another Kobo',syncToKobo:true});
    await submitAcquisition(h.db,candidate,'13');
    expect(h.db.prepare("SELECT count(*) n FROM jobs WHERE status='queued'").get()).toEqual({n:1});
    expect(claimJob(h.db)).toBeUndefined();
    h.db.prepare("UPDATE jobs SET status='complete' WHERE id=?").run(job.id);
    expect(claimJob(h.db)).toBeDefined();
    await step(); expect(acquisition(h.db,h.id)!.status).toBe('ready_for_kobo'); expect(h.downloadPosts).toBe(0);
  });
  it('never queues a source ID already active in Shelfmark', async () => {
    const { h, start, step } = setup(); h.activity=[{id:release.source_id,source:release.source,state:'downloading',added_time:Date.now()/1000}];
    await start();await step();await step();await step();expect(h.downloadPosts).toBe(0);expect(acquisition(h.db,h.id)!.status).toBe('needs_attention');
  });
  it('requires the operator to disable Book Dock auto-finalization before queuing', async () => {
    const { h, start, step } = setup(); h.autoFinalize = true;
    await start(); await step(); await step(); await step(); expect(h.downloadPosts).toBe(0); expect(acquisition(h.db, h.id)!.status).toBe('needs_attention');
  });
});
