import { z } from 'zod';
import { getDb } from '@/src/lib/db';
import { requireCsrf, requireOwnerApi } from '@/src/lib/auth';
import { activeFeedback } from '@/src/lib/recommendation/profile';
const schema = z.object({ workKey: z.string().min(16).max(128), action: z.enum(['already_read', 'not_interested', 'not_now', 'saved', 'get_book']), reason: z.string().max(500).optional() });
export async function GET() { const auth = await requireOwnerApi(); if (auth)
    return auth; return Response.json({ items: activeFeedback(getDb()) }, { headers: { 'Cache-Control': 'private, no-store' } }); }
export async function POST(request: Request) { const auth = await requireOwnerApi(); if (auth)
    return auth; const csrf = await requireCsrf(); if (csrf)
    return csrf; const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success)
    return Response.json({ error: 'Invalid feedback' }, { status: 400 }); const db = getDb(); const batches = db.prepare("SELECT result_json FROM recommendation_batches WHERE status='complete' ORDER BY completed_at DESC LIMIT 100").all() as {
    result_json: string;
}[]; const candidate = batches.flatMap(b => JSON.parse(b.result_json).items).find(b => b.workKey === parsed.data.workKey); if (!candidate)
    return Response.json({ error: 'Unknown recommendation' }, { status: 400 }); const result = db.prepare('INSERT INTO feedback(work_key,action,reason,candidate_json,created_at) VALUES(?,?,?,?,?)').run(parsed.data.workKey, parsed.data.action, parsed.data.reason || null, JSON.stringify(candidate), new Date().toISOString()); return Response.json({ ok: true, id: result.lastInsertRowid }); }
export async function DELETE(request: Request) { const auth = await requireOwnerApi(); if (auth)
    return auth; const csrf = await requireCsrf(); if (csrf)
    return csrf; const parsed = z.object({ id: z.number().int().positive() }).safeParse(await request.json().catch(() => null)); if (!parsed.success)
    return Response.json({ error: 'Invalid feedback ID' }, { status: 400 }); const db = getDb(); if (!db.prepare('SELECT id FROM feedback WHERE id=?').get(parsed.data.id))
    return Response.json({ error: 'Feedback not found' }, { status: 404 }); db.prepare('INSERT OR IGNORE INTO feedback_undo VALUES(?,?)').run(parsed.data.id, new Date().toISOString()); return Response.json({ ok: true }); }
