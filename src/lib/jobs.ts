import type { ShelfDb } from './db';
export type Job = {
    id: string;
    type: string;
    payload_json: string;
    attempts: number;
};
export function claimJob(db: ShelfDb, now = new Date().toISOString()): Job | undefined { return db.transaction(() => { db.prepare("UPDATE jobs SET status='queued',locked_at=NULL,run_after=? WHERE status='running' AND locked_at<?").run(now, new Date(Date.parse(now) - 120000).toISOString()); const job = db.prepare("SELECT id,type,payload_json,attempts FROM jobs WHERE status='queued' AND run_after<=? AND (type='recommendation' OR NOT EXISTS (SELECT 1 FROM jobs running WHERE running.status='running' AND running.type!='recommendation' AND json_extract(running.payload_json,'$.id')=json_extract(jobs.payload_json,'$.id'))) ORDER BY run_after LIMIT 1").get(now) as Job | undefined; if (job)
    db.prepare("UPDATE jobs SET status='running',locked_at=?,attempts=attempts+1,updated_at=? WHERE id=?").run(now, now, job.id); return job; }).immediate(); }
