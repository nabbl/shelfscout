import { afterEach, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { incomingEvidence, sameFile } from '../src/lib/acquisition-files';
const dirs: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })); });
function setup() { const dir = mkdtempSync(join(tmpdir(), 'shelfscout-files-')); dirs.push(dir); vi.stubEnv('SHELFSCOUT_INCOMING_DIR', dir); vi.stubEnv('SHELFMARK_OUTPUT_DIR', '/books'); writeFileSync(join(dir, 'file.epub'), 'Original local fixture'); return dir; }
it('hashes repeated observations and detects replacement even with the same bytes and filename', async () => {
  const dir = setup(); const first = await incomingEvidence('/books/file.epub');
  expect(sameFile(first, await incomingEvidence('/books/file.epub'))).toBe(true);
  rmSync(join(dir, 'file.epub')); writeFileSync(join(dir, 'file.epub'), 'Original local fixture');
  expect(sameFile(first, await incomingEvidence('/books/file.epub'))).toBe(false);
});
it.each(['/books/../secrets.epub', '/books-other/file.epub', '/books/nested/file.epub', '/books/file.epub.part', 'email://file.epub'])('rejects unprovable completed path %s', async file => {
  setup(); await expect(incomingEvidence(file)).rejects.toThrow();
});
it('rejects symlink files and nested incoming units', async () => {
  const dir = setup(); symlinkSync(join(dir, 'file.epub'), join(dir, 'link.epub'));
  await expect(incomingEvidence('/books/link.epub')).rejects.toThrow(/symlink/);
  rmSync(join(dir, 'link.epub')); mkdirSync(join(dir, 'another-unit'));
  await expect(incomingEvidence('/books/file.epub')).rejects.toThrow(/nested/);
});
