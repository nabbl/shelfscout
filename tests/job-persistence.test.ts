import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase } from '../src/lib/db';
import { claimJob } from '../src/lib/jobs';
import { queueBatch } from '../src/lib/recommendation/engine';
it('recovers an interrupted recommendation job after database reopen without stealing a live lease', () => { const dir = mkdtempSync(join(tmpdir(), 'shelfscout-test-')); try {
    let db = createDatabase(join(dir, 'test.sqlite'));
    const id = queueBatch(db, { mood: 'quiet', mode: 'more', rereads: false });
    const now = new Date().toISOString();
    const job = claimJob(db, now)!;
    expect(job.type).toBe('recommendation');
    expect(claimJob(db, now)).toBeUndefined();
    db.close();
    db = createDatabase(join(dir, 'test.sqlite'));
    const recovered = claimJob(db, new Date(Date.parse(now) + 121000).toISOString())!;
    expect(recovered.id).toBe(job.id);
    expect(JSON.parse(recovered.payload_json).id).toBe(id);
    expect(recovered.attempts).toBe(1);
    db.close();
}
finally {
    rmSync(dir, { recursive: true, force: true });
} });
