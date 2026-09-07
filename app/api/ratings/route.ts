import { z } from 'zod';
import { getDb } from '@/src/lib/db';
import { requireOwnerApi, requireCsrf } from '@/src/lib/auth';
export async function PUT(request: Request) { const auth = await requireOwnerApi(); if (auth)
    return auth; const csrf = await requireCsrf(); if (csrf)
    return csrf; const parsed = z.object({ workKey: z.string().min(16).max(128), rating: z.number().int().min(1).max(5).nullable() }).safeParse(await request.json().catch(() => null)); if (!parsed.success)
    return Response.json({ error: 'Invalid rating' }, { status: 400 }); const db = getDb(); const { workKey, rating } = parsed.data; const record = db.prepare('SELECT id FROM reading_records WHERE work_key=?').get(workKey); const feedback = db.prepare('SELECT id FROM feedback WHERE work_key=?').get(workKey); if (!record && !feedback)
    return Response.json({ error: 'Record feedback or import this book first' }, { status: 400 }); if (rating === null)
    db.prepare('DELETE FROM companion_ratings WHERE work_key=?').run(workKey);
else
    db.prepare('INSERT OR REPLACE INTO companion_ratings VALUES(?,?,?)').run(workKey, rating, new Date().toISOString()); return Response.json({ ok: true }); }
