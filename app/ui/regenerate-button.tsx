'use client';
import { useId } from 'react';
import { Sparkles } from 'lucide-react';
import type { RecommendationProgress } from '@/src/lib/recommendation/progress';

export function RegenerateButton({ busy, progress, onClick }: { busy: boolean; progress: RecommendationProgress; onClick: () => void }) {
  const progressId = useId();
  const percent = busy ? progress.percent : 100;
  return <>
    <button className="regenerate-suggestions" disabled={busy} aria-busy={busy} aria-label={busy ? 'Generating suggestions…' : 'Regenerate suggestions'} aria-describedby={busy ? progressId : undefined} onClick={onClick} title={busy ? `${progress.label}. Progress through generation steps.` : undefined}>
      <span className={`regenerate-fill${busy && percent === null ? ' indeterminate' : ''}`} aria-hidden="true" style={{ width: `${percent ?? 30}%`, transition: percent === 0 ? 'none' : undefined }}/>
      <span className="regenerate-label"><Sparkles size={18}/>{busy ? <>Generating…{percent !== null && <span className="regenerate-percent">{percent}%</span>}</> : 'Regenerate suggestions'}</span>
    </button>
    {busy && <span id={progressId} className="regeneration-progress" role="progressbar" aria-label="Suggestion generation" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined} aria-valuetext={`${progress.label}${percent !== null ? `. ${percent}% through generation steps` : ''}`}>{progress.label}</span>}
  </>;
}
