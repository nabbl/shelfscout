import { randomUUID } from 'node:crypto';
import type { ShelfDb } from './db';
import { BookOrbitClient } from './bookorbit';
import { normalize } from './identity';
import { ratingProviders, type RatingProvider, type RatingCandidate } from './metadata-ratings';
import type { Candidate } from './recommendations';

export const RATING_TTL = 7 * 86400000;
const RETRY_TTL = 15 * 60000;

export function ratingSourceUrl(provider: RatingProvider, value?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const allowed = provider === 'goodreads' ? /^(www\.)?goodreads\.com$/ : /^(www\.)?amazon\.(com|co\.uk|de|fr|it|es|ca|com\.au|co\.jp|in|com\.br|com\.mx|nl|se|pl|com\.be|ie)$/;
    if (!allowed.test(url.hostname)) return null;
    // Provider product URLs can carry affiliate/query tracking. Only retain the source page.
    url.search = ''; url.hash = '';
    return url.href;
  } catch { return null; }
}

export function matchRating(book: Pick<Candidate, 'title' | 'author' | 'isbn13'>, candidates: RatingCandidate[], provider: RatingProvider) {
  return candidates.filter(item => item.provider === provider && normalize(item.title || '') === normalize(book.title)
    && item.authors?.some(author => normalize(author) === normalize(book.author))
    && (!book.isbn13 || item.isbn13 === book.isbn13)
    && typeof item.communityRating === 'number' && item.communityRating > 0 && item.communityRating <= 5
    && ratingSourceUrl(provider, item.sourceUrl))
    .sort((a, b) => (b.communityRatingCount || 0) - (a.communityRatingCount || 0) || a.providerId.localeCompare(b.providerId))[0];
}

export function queueRatingRefresh(db: ShelfDb, batchId: string, force = false) {
  return db.transaction(() => {
    const existing = db.prepare("SELECT id FROM jobs WHERE type='ratings' AND status IN ('queued','running') AND json_extract(payload_json,'$.id')=? LIMIT 1").get(batchId) as {id:string} | undefined;
    if (existing) return existing.id;
    const id = randomUUID(), now = new Date().toISOString();
    db.prepare("INSERT INTO jobs(id,type,payload_json,status,run_after,created_at,updated_at) VALUES(?,'ratings',?,'queued',?,?,?)").run(id, JSON.stringify({id:batchId,force}), now, now, now);
    return id;
  })();
}

function record(db: ShelfDb, book: Candidate, provider: RatingProvider, status: string, message: string, match?: RatingCandidate) {
  const now = new Date().toISOString();
  const url = match && ratingSourceUrl(provider, match.sourceUrl);
  db.prepare(`INSERT INTO ratings(work_key,source,source_identifier,marketplace,rating,rating_count,retrieval_status,last_attempted_at,last_success_at,source_url,raw_json)
    VALUES(?,?,?,'',?,?,?,?,?,?,?) ON CONFLICT(work_key,source,marketplace) DO UPDATE SET
    rating=COALESCE(excluded.rating,ratings.rating),rating_count=CASE WHEN excluded.rating IS NULL THEN ratings.rating_count ELSE excluded.rating_count END,
    source_identifier=COALESCE(excluded.source_identifier,ratings.source_identifier),source_url=CASE WHEN excluded.rating IS NULL THEN ratings.source_url ELSE excluded.source_url END,
    retrieval_status=excluded.retrieval_status,last_attempted_at=excluded.last_attempted_at,last_success_at=COALESCE(excluded.last_success_at,ratings.last_success_at),raw_json=excluded.raw_json`)
    .run(book.workKey, `bookorbit-${provider}`, match?.providerId || null, match?.communityRating ?? null, match?.communityRatingCount ?? null, status, now, match ? now : null, url || book.ratings[provider].url, JSON.stringify({message,via:'BookOrbit'}));
}

export async function refreshBatchRatings(db: ShelfDb, batchId: string, force = false, client = new BookOrbitClient()) {
  const row = db.prepare("SELECT result_json FROM recommendation_batches WHERE id=? AND status='complete'").get(batchId) as {result_json:string} | undefined;
  if (!row) return;
  const items = (JSON.parse(row.result_json).items as Candidate[]).slice(0,9);
  let enabled: RatingProvider[];
  try {
    const providers = await client.ratingProviders();
    enabled = ratingProviders.filter(provider => providers.some(item => item.key === provider));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'BookOrbit rating connection failed.';
    for (const book of items) for (const provider of ratingProviders) record(db, book, provider, 'failed', message);
    throw error;
  }
  for (const book of items) {
    const wanted = ratingProviders.filter(provider => {
      if (force) return true;
      const cached = db.prepare("SELECT last_attempted_at,retrieval_status FROM ratings WHERE work_key=? AND source=? AND marketplace='' ORDER BY id DESC LIMIT 1").get(book.workKey, `bookorbit-${provider}`) as {last_attempted_at:string;retrieval_status:string} | undefined;
      return !cached || Date.now() - Date.parse(cached.last_attempted_at) >= (cached.retrieval_status === 'ok' ? RATING_TTL : RETRY_TTL);
    });
    if (!wanted.length) continue;
    for (const provider of wanted.filter(provider => !enabled.includes(provider))) record(db, book, provider, 'disabled', `Enable the ${provider === 'goodreads' ? 'Goodreads' : 'Amazon'} metadata provider in BookOrbit.`);
    const active = wanted.filter(provider => enabled.includes(provider));
    if (!active.length) continue;
    try {
      const result = await client.searchRatings(book, active);
      for (const provider of active) {
        const match = matchRating(book, result.candidates, provider);
        const failure = result.failures[provider];
        record(db, book, provider, match ? 'ok' : failure || 'not_found', match ? '' : failure ? `BookOrbit’s ${provider} provider reported ${failure}. Try refreshing later.` : 'No rating returned for a matching title and author.', match);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'BookOrbit rating lookup failed.';
      for (const provider of active) record(db, book, provider, 'failed', message);
    }
  }
}
