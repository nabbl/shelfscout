/* eslint-disable @next/next/no-img-element */
'use client';
import { useEffect, useRef, useState } from 'react';
import { BookOpen, ChevronRight, Search, X } from 'lucide-react';
import { readingStatuses, statusLabel, type HistoryBook, type ReadingStatus } from '@/src/lib/history-types';
import { settingsRequest } from './settings-request';

export function ReadingHistory({ query, onQueryChange }: { query: string; onQueryChange: (value: string) => void }) {
  const [books, setBooks] = useState<HistoryBook[]>([]);
  const [selected, setSelected] = useState<HistoryBook | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true); setLoadError('');
      try {
        const response = await fetch(`/api/history?q=${encodeURIComponent(query)}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
        if (!response.ok) throw new Error('History could not be loaded. Please retry.');
        const data = await response.json();
        if (!controller.signal.aborted) setBooks(data.items);
      } catch (cause) {
        if (!controller.signal.aborted) setLoadError(cause instanceof Error ? cause.message : 'History could not be loaded.');
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [query, revision]);

  async function save(book: HistoryBook, change: { status: ReadingStatus | null } | { rating: number | null }) {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const { token } = await settingsRequest('/api/auth/csrf');
      const statusChange = 'status' in change;
      await settingsRequest(statusChange ? '/api/history' : '/api/ratings', {
        method: statusChange ? 'PATCH' : 'PUT', headers: { 'Content-Type': 'application/json', 'x-csrf-token': token },
        body: JSON.stringify({ workKey: book.work_key, ...change }),
      });
      const update = (row: HistoryBook): HistoryBook => row.work_key !== book.work_key ? row : 'status' in change
        ? { ...row, status_override: change.status, exclusive_status: change.status ?? row.imported_status }
        : { ...row, personal_rating: change.rating ?? row.imported_rating };
      setBooks(current => current.map(update));
      setSelected(current => current ? update(current) : null);
      setNotice(statusChange ? `Status saved for ${book.title}.` : `Rating saved for ${book.title}.`);
      setRevision(value => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Change could not be saved. Please retry.'); }
    finally { submitting.current = false; setBusy(false); }
  }
  const controls = (book: HistoryBook) => <HistoryControls book={book} busy={busy} onStatus={status => void save(book, { status })} onRating={rating => void save(book, { rating })}/>;
  return <>
    <label className="history-search"><Search size={18}/><input type="search" aria-label="Search books" placeholder="Search history by title or author…" value={query} onChange={event => onQueryChange(event.target.value)}/></label>
    <p className="history-intro">Open a book to see its cover and details. Your status edits stay saved when you reimport Goodreads.</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {loadError ? <p role="alert">{loadError} <button onClick={() => setRevision(value => value + 1)}>Retry</button></p> : <>
      {loading && <p role="status">Loading history…</p>}
      <div className="history-list">{books.map(book => <article key={book.id}>
        <button className="history-book-link" aria-label={`View details for ${book.title}`} aria-haspopup="dialog" onClick={() => { setError(''); setNotice(''); setSelected(book); }}>
          <BookOpen size={22}/><span><strong>{book.title}</strong><span>{book.author || 'Unknown author'}</span></span><ChevronRight size={18}/>
        </button>
        {controls(book)}
      </article>)}</div>
      {!loading && !books.length && <div className="empty-state">{query.trim() ? 'No books match your search.' : 'No books imported yet. Add your Goodreads CSV in Settings.'}</div>}
    </>}
    {selected && <HistoryDetails key={selected.id} book={selected} busy={busy} onClose={() => setSelected(null)}>
      {controls(selected)}
      {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    </HistoryDetails>}
  </>;
}

function HistoryControls({ book, busy, onStatus, onRating }: { book: HistoryBook; busy: boolean; onStatus: (status: ReadingStatus | null) => void; onRating: (rating: number | null) => void }) {
  return <div className="history-controls">
    <label>Reading status<select aria-label={`Reading status for ${book.title}`} disabled={busy} value={book.status_override ?? ''} onChange={event => onStatus(event.target.value ? event.target.value as ReadingStatus : null)}>
      <option value="">Goodreads: {statusLabel(book.imported_status)}</option>
      {readingStatuses.map(status => <option key={status.value} value={status.value}>{status.label}</option>)}
    </select></label>
    <label>My rating<select aria-label={`Rate ${book.title}`} disabled={busy} value={book.personal_rating ?? ''} onChange={event => onRating(event.target.value ? Number(event.target.value) : null)}>
      <option value="">{book.imported_rating ? `Goodreads: ${book.imported_rating} stars` : 'Unrated'}</option>
      {[1, 2, 3, 4, 5].map(rating => <option key={rating} value={rating}>{rating} stars</option>)}
    </select></label>
  </div>;
}

function HistoryDetails({ book, busy, onClose, children }: { book: HistoryBook; busy: boolean; onClose: () => void; children: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [cover, setCover] = useState(book.cover_url);
  const [lookup, setLookup] = useState(!book.cover_url);
  const [coverLoading, setCoverLoading] = useState(true);
  const [coverError, setCoverError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    if (!lookup) return;
    const controller = new AbortController();
    async function loadCover() {
      setCoverLoading(true); setCoverError('');
      try {
        const response = await fetch(`/api/history/${book.id}/cover`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
        if (!response.ok) throw new Error('Cover lookup is temporarily unavailable.');
        const data = await response.json();
        if (!controller.signal.aborted) { setCover(data.coverUrl); if (!data.coverUrl) setCoverLoading(false); }
      } catch {
        if (!controller.signal.aborted) { setCoverError('Cover lookup is temporarily unavailable.'); setCoverLoading(false); }
      }
    }
    void loadCover();
    return () => controller.abort();
  }, [book.id, lookup, attempt]);
  function close() { dialog.current?.close(); onClose(); }
  return <dialog ref={dialog} className="history-dialog" aria-labelledby="history-detail-title" onCancel={event => { event.preventDefault(); if (!busy) close(); }}>
    <button className="modal-close" aria-label="Close book details" disabled={busy} onClick={close}><X/></button>
    <div className="history-detail-layout">
      <div className="history-detail-cover">
        {cover && <img src={cover} alt={`Cover of ${book.title}`} onLoad={() => setCoverLoading(false)} onError={() => { setCover(null); if (!lookup) setLookup(true); else setCoverLoading(false); }}/>}
        {!cover && <div className="cover-placeholder"><BookOpen/><span>{coverLoading ? 'Looking for a cover…' : 'Cover unavailable'}</span></div>}
        {coverError && <p role="status">{coverError} <button onClick={() => setAttempt(value => value + 1)}>Retry cover</button></p>}
      </div>
      <div className="history-detail-info"><p className="eyebrow">READING HISTORY</p><h2 id="history-detail-title">{book.title}</h2><p className="author">{book.author || 'Unknown author'}</p>
        {children}
        <dl><dt>Current status</dt><dd>{statusLabel(book.exclusive_status)}</dd>
          {book.date_read && <><dt>Date read (Goodreads)</dt><dd>{book.date_read}</dd></>}
          {book.date_added && <><dt>Date added (Goodreads)</dt><dd>{book.date_added}</dd></>}
          {(book.isbn13 || book.isbn) && <><dt>ISBN (Goodreads)</dt><dd>{book.isbn13 || book.isbn}</dd></>}
        </dl>
        <p className="history-import-note">Choose “Goodreads” to restore the imported status or rating.</p>
      </div>
    </div>
  </dialog>;
}
