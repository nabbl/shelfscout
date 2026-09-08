'use client';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { MoodSuggestion } from '@/src/lib/recommendation/moods';
import { settingsRequest } from './settings-request';

const demoMoods: MoodSuggestion[] = [
  { id: 'reflective', label: 'Thoughtful & reflective', query: 'memory', reason: 'Illustrative demo suggestion.', books: [] },
  { id: 'strange', label: 'Something strange', query: 'surrealism', reason: 'Illustrative demo suggestion.', books: [] },
];
export function MoodPicker({ live, value, batchId, onChange, onSettings }: { live: boolean; value: string; batchId: string; onChange(value: string): void; onSettings(): void }) {
  const [options, setOptions] = useState<MoodSuggestion[]>(live ? [] : demoMoods);
  const [hidden, setHidden] = useState(0);
  const [loading, setLoading] = useState(live);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!live) return;
    let active = true;
    settingsRequest('/api/taste').then(data => { if (active) { setOptions(data.moods || []); setHidden(data.profile?.settings.hiddenMoods?.length || 0); setError(''); } })
      .catch(() => { if (active) setError('Could not load mood suggestions.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [live, batchId, revision]);
  async function changeHidden(option?: MoodSuggestion) {
    setBusy(true); setError('');
    try {
      if (live) {
        const { token } = await settingsRequest('/api/auth/csrf');
        await settingsRequest('/api/taste', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-csrf-token': token }, body: JSON.stringify(option ? { hideMood: option.id } : { restoreMoods: true }) });
        setRevision(v => v + 1);
      } else { setOptions(option ? options.filter(item => item.id !== option.id) : demoMoods); setHidden(option ? hidden + 1 : 0); }
      if (option?.query === value) onChange('');
    } catch { setError('Could not save the mood change. Please retry.'); }
    finally { setBusy(false); }
  }
  return <section className="mood-picker" aria-labelledby="mood-heading">
    <div className="mood-heading"><div><h2 id="mood-heading">Reading mood</h2></div><button onClick={onSettings}>Tune my taste</button></div>
    {loading && <p role="status">Finding suggestions from your reading…</p>}
    {error && <p role="alert">{error} <button onClick={() => setRevision(v => v + 1)}>Retry</button></p>}
    <div className="mood-options">{options.map(option => <div className="mood-option" key={option.id}><div><button className={value === option.query ? 'active' : ''} aria-pressed={value === option.query} disabled={busy} onClick={() => onChange(value === option.query ? '' : option.query)}>{option.label}</button><button className="remove-mood" aria-label={`Remove ${option.label} suggestion`} disabled={busy} onClick={() => void changeHidden(option)}><X size={16}/></button></div><small>{option.reason}</small></div>)}</div>
    {!loading && !options.length && !error && <p>{hidden ? 'Your mood suggestions are hidden. Restore them below when you want them back.' : 'Suggestions appear from your read books, ratings and saved preferences. Regenerate suggestions after importing history to include catalog themes.'}</p>}
    {(value || hidden > 0) && <div className="mood-controls">{value ? <><span>Current focus: {options.find(option => option.query === value)?.label || value}</span><button onClick={() => onChange('')}>Clear mood</button></> : <span>No mood selected — use my usual taste.</span>}{hidden > 0 && <button disabled={busy} onClick={() => void changeHidden()}>Restore hidden moods</button>}</div>}
  </section>;
}
