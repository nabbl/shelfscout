'use client';
import { useEffect, useRef, useState } from 'react';
import type { SeriesEntry, SeriesMembership, SeriesResult } from '@/src/lib/recommendation/types';
import { settingsRequest } from './settings-request';

export function SeriesDialog({ book, onClose, onGet }: { book: { id: string; title: string; series?: string | null; seriesMemberships?: SeriesMembership[] }; onClose: () => void; onGet: (books: SeriesEntry[], name: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="series-dialog" aria-label={`Series for ${book.title}`} onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="series-dialog-heading"><h2>Explore the series</h2><button onClick={onClose}>Close</button></div>
    <p>From {book.title}</p>
    <SeriesDetails key={book.id} work={book.id} name={book.series} memberships={book.seriesMemberships} live autoOpen onGet={onGet}/>
  </dialog>;
}

export function SeriesDetails({ work, name, memberships, live, autoOpen = false, onGet }: { work: string; name?: string | null; memberships?: SeriesMembership[]; live: boolean; autoOpen?: boolean; onGet?: (books: SeriesEntry[], seriesName: string) => void }) {
  const [result, setResult] = useState<SeriesResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const loading = useRef(false);
  const series = result?.series || memberships?.[0];
  const eligible = (member: SeriesEntry) => !member.owned && !member.requested;
  async function load(retry = false) {
    if (loading.current) return;
    if (result && !retry) { setOpen(value => !value); return; }
    loading.current = true;
    setBusy(true); setError(''); setOpen(true);
    try {
      const data: SeriesResult = await settingsRequest(`/api/recommendations/series?work=${encodeURIComponent(work)}`);
      setResult(data);
      setSelected(data.books.filter(member => eligible(member) && !member.read).map(member => member.key));
    }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not load the series.'); }
    finally { loading.current = false; setBusy(false); }
  }
  useEffect(() => {
    if (live && autoOpen) { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }
    // The parent keys this component by work, so a different book starts a fresh lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, autoOpen]);
  const firstBooks = result?.books.filter(member => member.position === 1) || [];
  const first = result?.complete && firstBooks.length === 1 ? firstBooks[0] : null;
  const chosen = result?.books.filter(member => eligible(member) && selected.includes(member.key)) || [];
  const displayName = series?.name || (name && !name.includes('[object Object]') ? name : 'Series information has not been verified');
  return <section className="series-details">
    <h4>Series</h4>
    <p>{displayName}{series?.position != null ? ` · Book ${series.position}` : ''}</p>
    {live && /^\/works\/OL\d+W$/.test(work) && <button disabled={busy} onClick={() => void load()}>{busy ? 'Loading series…' : error ? 'Retry series lookup' : result && open ? 'Hide series' : name || series ? 'Show series' : 'Check series'}</button>}
    {error && <p role="alert">{error}</p>}
    {open && result && <>
      <p>{result.message}</p>
      {result.stale && <p>Last checked: {new Date(result.checkedAt).toLocaleDateString()}. <button disabled={busy} onClick={() => void load(true)}>Retry series lookup</button></p>}
      {result.books.length > 0 ? <>
        {onGet && <div className="series-actions">
          {first ? <button className="get" disabled={!eligible(first)} onClick={() => onGet([first], displayName)}>{first.owned ? 'Book one is owned' : first.requested ? 'Book one is requested' : 'Get first book'}</button> : <p>A unique book one could not be verified. Choose from the listed books below.</p>}
          <p>Catalog numbering may differ from recommended reading order, especially for prequels. Unnumbered books appear last.</p>
          <button onClick={() => setSelected(result.books.filter(eligible).map(member => member.key))}>Select all available books</button>
          <button onClick={() => setSelected(result.books.filter(member => eligible(member) && !member.read).map(member => member.key))}>Select unread books</button>
          <button onClick={() => setSelected([])}>Clear selection</button>
        </div>}
        <ol className="series-books">{result.books.map(member => <li key={member.key}>
          {onGet && <label className="series-select"><input type="checkbox" aria-label={`Select ${member.title}`} checked={selected.includes(member.key)} disabled={!eligible(member)} onChange={event => setSelected(current => event.target.checked ? [...current, member.key] : current.filter(key => key !== member.key))}/></label>}
          <span>{member.position == null ? '?' : member.position}</span>
          <div><a href={member.sourceUrl} target="_blank" rel="noreferrer">{member.title} ↗</a><small>{member.author}{member.read ? ' · Already read' : ''}{member.owned ? ' · Owned in BookOrbit' : member.requested ? ' · Requested' : ''}{member.key === work ? ' · This book' : ''}</small>
          {onGet && <button disabled={!eligible(member)} aria-label={`Get ${member.title}`} onClick={() => onGet([member], displayName)}>{member.owned ? 'Owned' : member.requested ? 'Requested' : 'Get book'}</button>}</div>
        </li>)}</ol>
        {onGet && <div className="series-actions"><button className="get" disabled={!chosen.length} onClick={() => onGet(chosen, displayName)}>Get selected books ({chosen.length})</button><p>Unread books are selected by default. Books already known to be owned or requested are skipped. Ownership is checked again before downloading.</p></div>}
      </> : result.series && <p>No book list is available yet.</p>}
    </>}
  </section>;
}
