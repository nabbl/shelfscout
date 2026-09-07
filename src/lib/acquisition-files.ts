import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

export interface FileEvidence { path: string; name: string; size: number; sha256: string; stamp: string; observedAt: string; }
export const MAX_EPUB_BYTES = 512 * 1024 * 1024;
export async function checkIncomingDirectory() {
  const localRoot = process.env.SHELFSCOUT_INCOMING_DIR;
  if (!localRoot || !path.isAbsolute(localRoot)) throw new Error('Configure an absolute SHELFSCOUT_INCOMING_DIR.');
  const root = await realpath(localRoot);
  const entries = await readdir(root, { withFileTypes: true });
  if (entries.some(e => e.isSymbolicLink() || (e.isDirectory() && e.name !== 'covers'))) throw new Error('Incoming directory contains nested files or symlinks; use a flat Book Dock directory to ensure unambiguous correlation.');
  return root;
}
export async function incomingEvidence(downloadPath: string): Promise<FileEvidence> {
  const upstreamRoot = process.env.SHELFMARK_OUTPUT_DIR;
  const localRoot = process.env.SHELFSCOUT_INCOMING_DIR;
  if (!upstreamRoot || !localRoot || !path.posix.isAbsolute(upstreamRoot) || !path.isAbsolute(localRoot)) throw new Error('Configure the absolute Shelfmark output and ShelfScout incoming directory mappings.');
  const relative = path.posix.relative(upstreamRoot, downloadPath);
  // Book Dock does not expose absolute paths or hashes. Only a flat, unique
  // loose-file mapping is provable with this API version; never guess a unit.
  if (!relative || relative.includes('/') || relative === '..' || !relative.toLowerCase().endsWith('.epub')) throw new Error('Completed output must be a single EPUB directly in the configured incoming directory. Review Shelfmark folder organization.');
  const root = await checkIncomingDirectory();
  const file = await open(path.join(root, relative), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size < 1 || before.size > MAX_EPUB_BYTES) throw new Error('Completed EPUB size is invalid or exceeds 512 MiB.');
    const hash = createHash('sha256');
    for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk);
    const after = await file.stat();
    const stamp = (s: typeof before) => `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
    if (stamp(before) !== stamp(after)) throw new Error('Incoming file is still changing. Recheck after completed delivery.');
    return { path: downloadPath, name: relative, size: after.size, sha256: hash.digest('hex'), stamp: stamp(after), observedAt: new Date().toISOString() };
  } finally { await file.close(); }
}
export function sameFile(a: FileEvidence, b: FileEvidence) { return a.path === b.path && a.size === b.size && a.sha256 === b.sha256 && a.stamp === b.stamp; }
