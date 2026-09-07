import { UpstreamHttpError, upstreamConnectionError } from './upstream-errors';
import { configuredUpstreamUrl } from './security';
import { languageCode } from './acquisition-identity';
import type { BookCandidate } from './bookorbit';

export interface Release { source: string; source_id: string; title: string; format?: string | null; language?: string | null; size?: string | null; size_bytes?: number | null; content_type?: string | null; extra?: Record<string, unknown>; download_url?: string | null; info_url?: string | null; }
export interface DownloadActivity { id: string; source: string; state: string; download_path?: string | null; added_time?: number; }
export class ShelfmarkClient {
  private base: URL;
  constructor(base = process.env.SHELFMARK_URL, private cookie = process.env.SHELFMARK_COOKIE) { this.base = configuredUpstreamUrl(base, 'Shelfmark'); }
  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    try {
      const r = await fetch(new URL(`${this.base.pathname.replace(/\/$/, '')}/api${path}`, this.base.origin), { ...init, headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(this.cookie ? { Cookie: this.cookie } : {}) }, redirect: 'error', signal: AbortSignal.timeout(60_000), cache: 'no-store' });
      if (!r.ok) throw new UpstreamHttpError('Shelfmark', path, r.status);
      return await r.json() as T;
    } catch (error) {
      throw upstreamConnectionError('Shelfmark', error);
    }
  }
  health() { return this.call<unknown>('/health'); }
  async test() {
    const snapshot = await this.call<{ status: unknown }>('/activity/snapshot');
    if (!snapshot?.status || typeof snapshot.status !== 'object' || Array.isArray(snapshot.status)) throw new Error('Shelfmark activity contract is incompatible. Check the configured URL and installed version.');
    return { activityAccessible: true };
  }
  search(c: BookCandidate) {
    const params = new URLSearchParams({ provider: 'manual', book_id: c.isbn13 || 'shelfscout', title: c.title, author: c.author || '', languages: languageCode(c.language), content_type: 'ebook' });
    return this.call<{ releases: Release[]; errors?: string[] }>(`/releases?${params}`);
  }
  async download(release: Release) {
    const result = await this.call<{ status: string }>('/releases/download', { method: 'POST', body: JSON.stringify(release) });
    if (result.status !== 'queued') throw new Error('Shelfmark submission outcome is unknown. Recheck activity before any manual retry.');
  }
  async activity(): Promise<DownloadActivity[]> {
    const snapshot = await this.call<{ status: Record<string, Record<string, Omit<DownloadActivity, 'state'>>> }>('/activity/snapshot');
    if (!snapshot.status || typeof snapshot.status !== 'object') throw new Error('Shelfmark activity contract is incompatible.');
    const items = Object.entries(snapshot.status).flatMap(([state, entries]) => Object.entries(entries).map(([id, value]) => ({ ...value, id, state })));
    // History contains dismissed items, not a substitute for the active snapshot.
    for (let offset = 0; offset < 10000; offset += 100) {
      const page = await this.call<Array<{ item_type: string; final_status: string; snapshot?: { download?: Omit<DownloadActivity, 'state'> } }>>(`/activity/history?limit=100&offset=${offset}`);
      if (!Array.isArray(page)) throw new Error('Shelfmark history contract is incompatible.');
      for (const item of page) if (item.item_type === 'download' && item.snapshot?.download && !items.some(x => x.id === item.snapshot!.download!.id)) items.push({ ...item.snapshot.download, state: item.final_status });
      if (page.length < 100) return items;
    }
    throw new Error('Shelfmark history exceeded the reconciliation limit; review activity manually.');
  }
}
