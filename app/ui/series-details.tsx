'use client';
import { useState } from 'react';
import type { SeriesEntry, SeriesMembership } from '@/src/lib/recommendation/types';
import { settingsRequest } from './settings-request';

export function SeriesDetails({ work, name, memberships, live }: { work: string; name?: string | null; memberships?: SeriesMembership[]; live: boolean }) {
  const [result, setResult] = useState<{ series: SeriesMembership | null; books: SeriesEntry[]; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const series = memberships?.[0];
  async function load() {
    if (result) { setOpen(value => !value); return; }
    setBusy(true); setError(''); setOpen(true);
    try { setResult(await settingsRequest(`/api/recommendations/series?work=${encodeURIComponent(work)}`)); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not load the series.'); }
    finally { setBusy(false); }
  }
  return <section className="series-details">
    <h4>Series</h4>
    <p>{series?.name || name || 'No series information in the catalog'}{series?.position != null ? ` · Book ${series.position}` : ''}</p>
    {live && /^\/works\/OL\d+W$/.test(work) && <button disabled={busy} onClick={() => void load()}>{busy ? 'Loading series…' : result && open ? 'Hide series' : name || series ? 'Show series' : 'Check series'}</button>}
    {error && <p role="alert">{error}</p>}
    {open && result && <><p>{result.message}</p>{result.books.length > 0 ? <ol className="series-books">{result.books.map(member => <li key={member.key}><span>{member.position == null ? '?' : member.position}</span><div><a href={member.sourceUrl} target="_blank" rel="noreferrer">{member.title} ↗</a><small>{member.author}{member.read ? ' · Already read' : ''}{member.key === work ? ' · This book' : ''}</small></div></li>)}</ol> : result.series && <p>No ordered book list is available yet.</p>}</>}
  </section>;
}
