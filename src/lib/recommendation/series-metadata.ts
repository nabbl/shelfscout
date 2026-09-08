import type { SeriesMembership } from './types';

export function seriesPosition(value: unknown): number | null {
  const text = String(value ?? '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) && number >= 0 && number <= 10000 ? number : null;
}

export function namedSeries(value: unknown): SeriesMembership | null {
  if (typeof value !== 'string' || !value.trim() || value.includes('[object Object]')) return null;
  const text = value.trim().slice(0, 200);
  const numbered = /^(.*?)\s*(?:[,;]\s*|\s+)(?:#|book\s+|volume\s+)(\d+(?:\.\d+)?)$/i.exec(text);
  return { key: null, name: numbered?.[1]?.trim() || text, position: numbered ? seriesPosition(numbered[2]) : null };
}

/** Only explicit catalog labels count; ordinary subject/title words do not establish a series. */
export function explicitSeries(title: string, subjects: string[]): SeriesMembership[] {
  const titleLabel = /\(([^()]+(?:#|book\s+|volume\s+)\d+(?:\.\d+)?)\)\s*$/i.exec(title);
  const labels = [...(titleLabel ? [titleLabel[1]] : []), ...subjects.filter(s => /^series:/i.test(s)).map(s => s.slice(7))];
  return labels.flatMap(value => { const series = namedSeries(value); return series ? [series] : []; }).slice(0, 8);
}
