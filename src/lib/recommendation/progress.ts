export type RecommendationProgress = { percent: number | null; label: string };

/** Progress through pipeline steps, not an estimate of time remaining. */
export function recommendationProgress(status?: string, stage = ''): RecommendationProgress {
  if (status === 'complete') return { percent: 100, label: 'Suggestions ready' };
  if (status === 'queued') return { percent: 0, label: 'Waiting to start' };
  if (status !== 'running') return { percent: null, label: status === 'failed' ? 'Generation failed' : 'Starting generation' };
  const phases: { pattern: RegExp; start: number; end: number; label: string }[] = [
    { pattern: /^Resolving taste evidence (\d+)\/(\d+)$/, start: 5, end: 20, label: 'Reviewing your reading history' },
    { pattern: /^Searching catalog (\d+)\/(\d+)$/, start: 25, end: 50, label: 'Searching for books' },
    { pattern: /^Reading catalog evidence (\d+)\/(\d+)$/, start: 50, end: 80, label: 'Checking book details' },
    { pattern: /^(?:Checking series starting points|Finding book one) (\d+)\/(\d+)(?::.*)?$/, start: 80, end: 85, label: 'Checking series' },
    { pattern: /^Assessing preferences, mood and tradeoffs (\d+)\/(\d+)$/, start: 85, end: 95, label: 'Comparing books with your preferences' },
  ];
  for (const phase of phases) {
    const match = phase.pattern.exec(stage);
    if (!match) continue;
    const current = Number(match[1]), total = Number(match[2]);
    if (!Number.isSafeInteger(current) || !Number.isSafeInteger(total) || current < 1 || total < current) return { percent: null, label: phase.label };
    // The reported item is being processed; only preceding items are finished.
    return { percent: Math.floor(phase.start + (phase.end - phase.start) * (current - 1) / total), label: `${phase.label} (${current}/${total})` };
  }
  const fixed: Record<string, RecommendationProgress> = {
    'Building evidence profile': { percent: 5, label: 'Reviewing your preferences' },
    'Planning complementary catalog searches': { percent: 20, label: 'Planning book searches' },
    'Checking series starting points': { percent: 80, label: 'Checking series' },
    'Assessing preferences, mood and tradeoffs': { percent: 85, label: 'Comparing books with your preferences' },
    'Ranking recommendations': { percent: 95, label: 'Choosing your suggestions' },
    'Saving recommendations': { percent: 99, label: 'Saving your suggestions' },
  };
  if (fixed[stage]) return fixed[stage];
  // Older workers report series names without a counter.
  if (stage.startsWith('Finding book one of ')) return { percent: 80, label: 'Checking series' };
  return { percent: null, label: 'Generating suggestions' };
}
