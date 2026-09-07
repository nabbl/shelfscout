import type Database from "better-sqlite3";
import type { Candidate } from './recommendations';

/** Reuse imported community averages only for the same work or a resolved alias. */
export function withStoredRatings<T extends Candidate & { catalogKey?: string }>(db: Database.Database, candidate: T): T {
  const catalogKey = candidate.catalogKey || candidate.editionKey;
  const conflict = db.prepare('SELECT 1 FROM identity_conflicts WHERE catalog_key=? AND resolution IS NULL').get(catalogKey);
  if (conflict) return candidate;
  const row = db.prepare(`SELECT rating,rating_count,last_success_at,source_url FROM ratings
    WHERE source='goodreads-import' AND retrieval_status='import_snapshot' AND rating>0 AND rating<=5
      AND (work_key=? OR work_key IN (SELECT work_key FROM work_aliases WHERE catalog_key=?))
    ORDER BY last_success_at DESC,id DESC LIMIT 1`).get(candidate.workKey, catalogKey) as {
      rating: number; rating_count: number | null; last_success_at: string; source_url: string;
    } | undefined;
  let result = candidate;
  if (row) result = { ...candidate, ratings: { ...candidate.ratings, goodreads: {
    rating: row.rating, count: row.rating_count, status: 'import_snapshot', url: row.source_url,
    freshness: `CSV imported ${row.last_success_at.slice(0, 10)}; original rating date unknown`,
  } } };
  for (const provider of ['goodreads', 'amazon'] as const) {
    const live = db.prepare("SELECT * FROM ratings WHERE work_key=? AND source=? AND marketplace='' ORDER BY last_attempted_at DESC LIMIT 1").get(candidate.workKey, `bookorbit-${provider}`) as {
      rating: number | null; rating_count: number | null; retrieval_status: string; source_url: string; last_success_at: string | null; raw_json: string | null;
    } | undefined;
    if (!live) continue;
    const message = live.raw_json ? (JSON.parse(live.raw_json).message as string || '') : '';
    const available = live.rating != null && live.rating > 0 && live.rating <= 5;
    if (!available && result.ratings[provider].rating != null) {
      result = { ...result, ratings: { ...result.ratings, [provider]: { ...result.ratings[provider], message } } };
      continue;
    }
    const stale = live.retrieval_status !== 'ok' || !live.last_success_at || Date.now() - Date.parse(live.last_success_at) > 7 * 86400000;
    result = { ...result, ratings: { ...result.ratings, [provider]: {
      rating: available ? live.rating : null, count: live.rating_count,
      status: available ? stale ? 'stale' : 'bookorbit' : live.retrieval_status,
      url: live.source_url || result.ratings[provider].url,
      freshness: live.last_success_at ? `Retrieved ${live.last_success_at.slice(0, 10)} via BookOrbit${stale ? '; cached value, refresh needed' : ''}` : 'Not retrieved',
      message,
    } } };
  }
  return result;
}

/** Stores a source-labelled point-in-time snapshot. Missing ratings stay absent;
 * consumers must render them as unknown rather than inventing a value. */
export function cacheGoodreadsImportSnapshot(db:Database.Database,input:{workKey:string;title:string;author:string|null;rating:number|null}){
  if(input.rating===null)return;
  const now=new Date().toISOString();
  const sourceUrl=`https://www.goodreads.com/search?q=${encodeURIComponent(`${input.title} ${input.author||""}`.trim())}`;
  db.prepare(`INSERT INTO ratings(work_key,source,source_identifier,marketplace,rating,rating_count,retrieval_status,last_attempted_at,last_success_at,source_url,raw_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(work_key,source,marketplace) DO UPDATE SET rating=excluded.rating,retrieval_status=excluded.retrieval_status,last_attempted_at=excluded.last_attempted_at,last_success_at=excluded.last_success_at,source_url=excluded.source_url,raw_json=excluded.raw_json`).run(input.workKey,"goodreads-import",null,"",input.rating,null,"import_snapshot",now,now,sourceUrl,JSON.stringify({provenance:"Goodreads CSV Average Rating"}));
}
