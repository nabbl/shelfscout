import { claimJob } from "../src/lib/jobs";
import { getDb } from "../src/lib/db";
import { recoverAcquisitions, recordStatus } from "../src/lib/acquisition";
import { reconcileAcquisition } from "../src/lib/acquisition-worker";
import { generateBatch } from "../src/lib/recommendation/engine";
const db = getDb();
recoverAcquisitions(db);
let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });
const claim = () => claimJob(db);
async function tick() { const job = claim(); if (!job)
    return false; const heartbeat = setInterval(() => db.prepare("UPDATE jobs SET locked_at=? WHERE id=? AND status='running' AND attempts=?").run(new Date().toISOString(), job.id,job.attempts+1), 30000); try {
    const { id } = JSON.parse(job.payload_json) as {
        id: string;
    };
    if (job.type === "recommendation")
        await generateBatch(db, id);
    else if (await reconcileAcquisition(db, id)) {
        db.prepare("UPDATE jobs SET status='queued',attempts=0,run_after=?,locked_at=NULL,updated_at=? WHERE id=? AND status='running' AND attempts=?").run(new Date(Date.now()+30000).toISOString(),new Date().toISOString(),job.id,job.attempts+1);
        return true;
    }
    db.prepare("UPDATE jobs SET status='complete',locked_at=NULL,updated_at=? WHERE id=? AND status='running' AND attempts=?").run(new Date().toISOString(), job.id,job.attempts+1);
}
catch (error) {
    const message = job.type === "recommendation" && error instanceof Error ? error.message : "Acquisition worker failed. Recheck the saved acquisition.";
    if(job.type !== "recommendation" && job.attempts >= 8) recordStatus(db, JSON.parse(job.payload_json).id, "needs_attention", message);
    const delay = Math.min(300000, 5000 * 2 ** job.attempts);
    db.prepare("UPDATE jobs SET status=?,run_after=?,last_error=?,locked_at=NULL,updated_at=? WHERE id=? AND status='running' AND attempts=?").run(job.type === "recommendation" || job.attempts >= 8 ? "failed" : "queued", new Date(Date.now() + delay).toISOString(), message, new Date().toISOString(), job.id, job.attempts+1);
}
finally {
    clearInterval(heartbeat);
} return true; }
async function main() { while (!stopping) {
    if (!await tick())
        await new Promise(r => setTimeout(r, 1000));
} }
void main().catch(() => { console.error("Worker stopped unexpectedly"); process.exitCode = 1; });
