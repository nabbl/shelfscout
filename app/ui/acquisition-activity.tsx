'use client';
import { useEffect, useState } from 'react';
type ReleaseChoice = { index: number; title: string; author?: string; isbn?: string; year?: string; language?: string; format?: string; source: string; size?: string; selectable: boolean; reason: string };
type Item = { id: string; title: string; author: string; language: string; status: string; last_error?: string; upstream_book_id?: string; upstream_request_id?: string; workflow: string; canRetryDownload?: boolean; releases: ReleaseChoice[]; events: { status: string; detail: string; created_at: string }[] };
export function AcquisitionActivity() {
  const [items, setItems] = useState<Item[]>([]), [message, setMessage] = useState(''), [busy, setBusy] = useState<string | null>(null);
  async function load() { const response = await fetch('/api/acquisitions'); if (!response.ok) throw new Error('Could not load Activity. Check your login.'); setItems((await response.json()).items || []); }
  useEffect(() => { const refresh = () => void load().catch(e => setMessage(e.message)); refresh(); const timer = setInterval(refresh, 3000); return () => clearInterval(timer); }, []);
  async function act(id: string, action: string, releaseIndex?: number) {
    setBusy(id); setMessage('');
    try {
      const token = (await (await fetch('/api/auth/csrf')).json()).token;
      const response = await fetch(`/api/acquisitions/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': token }, body: JSON.stringify({ action, releaseIndex }) });
      if (!response.ok) throw new Error((await response.json()).error || 'Action failed.');
      setMessage(action === 'recheck' ? items.find(item => item.id === id)?.canRetryDownload ? 'Check queued. If Shelfmark confirms a retryable download failure, the saved release will be retried once.' : 'Recheck queued. Follow progress here.' : 'Release selected. Follow progress here.');
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Connection lost. Check Activity before retrying.'); }
    finally { setBusy(null); }
  }
  return <div className="acquisition-activity"><p>Ready for Kobo sync means the EPUB is available in BookOrbit and belongs to your Kobo-enabled collection. Device delivery is not confirmed.</p><p role="status">{message}</p>{!items.length && <p>No acquisitions yet.</p>}{items.map(item => <article className="acquisition-item" key={item.id}><h2>{item.title}</h2><p>{item.author} · {item.language} · <strong>{item.status.replaceAll('_', ' ')}</strong></p>{(item.workflow === 'legacy_bookorbit' || item.upstream_request_id) && <p>Existing BookOrbit request retained for reconciliation.</p>}{item.upstream_book_id && <p>BookOrbit book #{item.upstream_book_id}</p>}{item.last_error && <p role="alert">{item.last_error}</p>}{item.releases.length > 0 && <fieldset><legend>Confirm the release and edition</legend><p>The file’s embedded identity will also be verified before import.</p>{item.releases.map(release => <div className="release-choice" key={release.index}><strong>{release.title}</strong><p>{release.author || 'Author unknown'} · {release.year || 'Year unknown'} · ISBN {release.isbn || 'unknown'} · {release.language || 'language unknown'} · {release.format || 'format unknown'} · {release.source} · {release.size || 'size unknown'}</p><p>{release.reason}</p><button disabled={busy === item.id || !release.selectable} onClick={() => void act(item.id, 'select_release', release.index)}>Confirm this release</button></div>)}</fieldset>}{item.status === 'needs_attention' && <button disabled={busy === item.id} onClick={() => void act(item.id, 'recheck')}>{item.canRetryDownload ? 'Recheck / retry download' : 'Recheck / refresh releases'}</button>}<details><summary>Acquisition history</summary>{item.events.map((event, index) => <p key={index}><time>{event.created_at}</time> — {event.detail || event.status.replaceAll('_', ' ')}</p>)}</details></article>)}</div>;
}
