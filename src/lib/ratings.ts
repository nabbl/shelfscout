import type Database from "better-sqlite3";

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
