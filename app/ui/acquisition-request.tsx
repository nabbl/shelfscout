'use client';
import { useEffect, useRef, useState } from 'react';
import { settingsRequest } from './settings-request';

type RequestBook = { id: string; title: string; author: string; language?: string; isbn13?: string | null; cover: string; year: number | null };
type Collection = { id: number; name: string };

export function AcquisitionRequest({ book, initialCollectionId, onClose, onRequested, onActivity }: {
  book: RequestBook;
  initialCollectionId: string;
  onClose(): void;
  onRequested(collectionId: string): void;
  onActivity(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [collectionId, setCollectionId] = useState(initialCollectionId);
  const [language, setLanguage] = useState(book.language && book.language !== 'und' ? book.language : '');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    let active = true;
    settingsRequest('/api/integrations/bookorbit').then(data => {
      if (!active) return;
      const available = data.collections as Collection[];
      setCollections(available);
      setCollectionId(current => available.some(c => String(c.id) === current) ? current : String(available[0]?.id ?? ''));
    }).catch(error => { if (active) setError(error instanceof Error ? error.message : 'Could not load collections.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || loading || !collectionId || !language.trim() || language.trim() === 'und') return;
    submitting.current = true;
    setBusy(true); setError(''); setUncertain(false);
    let sent = false;
    let serverError = '';
    try {
      const { token } = await settingsRequest('/api/auth/csrf');
      sent = true;
      const response = await fetch('/api/acquisitions', {
        method: 'POST', signal: AbortSignal.timeout(65000),
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': token },
        body: JSON.stringify({ title: book.title, author: book.author, isbn13: book.isbn13 || null, language: language.trim(), providerKey: 'openlibrary', providerId: book.id, coverUrl: book.cover || null, publishedYear: book.year, targetCollectionId: collectionId }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status < 500) sent = false;
        serverError = typeof data.error === 'string' ? data.error : `Request failed (HTTP ${response.status}).`;
        throw new Error(serverError);
      }
      onRequested(collectionId);
    } catch (error) {
      setUncertain(sent);
      setError(sent ? `${serverError ? `${serverError} ` : ''}Request status could not be confirmed. Check Activity before retrying.` : error instanceof Error ? error.message : 'Could not submit the request. Please retry.');
    } finally { submitting.current = false; setBusy(false); }
  }

  return <dialog ref={dialog} className="acquisition-dialog" aria-labelledby="acquisition-title" onCancel={event => { event.preventDefault(); if (!submitting.current) onClose(); }}>
    <h2 id="acquisition-title">Get {book.title}</h2>
    <p>{book.author}</p>
    <form onSubmit={submit}>
      {loading ? <p role="status">Loading your Kobo collections…</p> : collections.length > 0 ? <label>Kobo collection<select value={collectionId} onChange={event => setCollectionId(event.target.value)} disabled={busy}>{collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label> : <p>No Kobo collections available. Enable Kobo sync for a collection in BookOrbit, then retry.</p>}
      {(!loading && !collections.length) && <button type="button" onClick={() => { setLoading(true); setError(''); setAttempt(value => value + 1); }}>Retry connection</button>}
      {book.language && book.language !== 'und' ? <p>Language: {book.language}</p> : <label>Requested language<p>The catalog has no language for this book. Choose the language you want to read.</p><input aria-label="Requested language" value={language} onChange={event => setLanguage(event.target.value)} placeholder="Language code, e.g. en or de" minLength={2} maxLength={20} required disabled={busy}/></label>}
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">Recording your request…</p>}
      {uncertain && <button type="button" onClick={onActivity}>Check Activity</button>}
      <div className="acquisition-dialog-actions"><button type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="get" disabled={busy || loading || !collectionId || !language.trim() || language.trim() === 'und'}>{busy ? 'Requesting…' : 'Get book'}</button></div>
    </form>
  </dialog>;
}
