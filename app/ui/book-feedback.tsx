'use client';
import { useEffect, useRef, useState } from 'react';

export type BookFeedbackAction = 'already_read' | 'not_now' | 'not_interested';
const choices: { action: BookFeedbackAction; label: string; description: string }[] = [
  { action: 'already_read', label: 'Already read', description: 'Keep it out of your unread recommendations.' },
  { action: 'not_now', label: 'Not now', description: 'Hide it for 30 days.' },
  { action: 'not_interested', label: 'Not interested', description: 'Exclude it from future picks until you undo this.' },
];

export function BookFeedback({ title, onClose, onChoose }: { title: string; onClose: () => void; onChoose: (action: BookFeedbackAction, reason: string) => Promise<boolean> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);

  function close() { dialog.current?.close(); onClose(); }

  async function choose(action: BookFeedbackAction) {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      if (await onChoose(action, action === 'already_read' ? '' : reason.trim())) close();
      else setError('Feedback could not be saved. Please retry.');
    } catch { setError('Feedback could not be saved. Please retry.'); }
    finally { submitting.current = false; setBusy(false); }
  }

  return <dialog ref={dialog} className="book-feedback-dialog" aria-labelledby="book-feedback-title" onCancel={event => { event.preventDefault(); if (!submitting.current) close(); }}>
    <h2 id="book-feedback-title">What about this book?</h2>
    <p>{title}</p>
    <div className="book-feedback-options">{choices.map(choice => <button key={choice.action} disabled={busy} onClick={() => void choose(choice.action)}><strong>{choice.label}</strong><span>{choice.description}</span></button>)}</div>
    <details><summary>Add a reason (optional)</summary><label>For Not now or Not interested<textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={500} rows={2} disabled={busy}/></label></details>
    {busy && <p role="status">Saving feedback…</p>}
    {error && <p role="alert">{error}</p>}
    <button className="feedback-cancel" disabled={busy} onClick={close}>Cancel</button>
  </dialog>;
}
