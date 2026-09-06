import { getDb } from '@/src/lib/db';
import { requireOwnerApi, requireCsrf } from '@/src/lib/auth';
import { buildProfile } from '@/src/lib/recommendation/profile';
import { settingsSchema } from '@/src/lib/recommendation/types';
export async function GET() { const auth = await requireOwnerApi(); if (auth)
    return auth; const db = getDb(); const profile = buildProfile(db); const last = db.prepare("SELECT result_json FROM recommendation_batches WHERE status='complete' ORDER BY completed_at DESC LIMIT 1").get() as {
    result_json: string;
} | undefined; const previous = last ? JSON.parse(last.result_json).profile : null; return Response.json({ profile, lastModelPreferences: (previous?.sourceVersion===profile.version?previous.preferences:[])?.filter((p: {
        origin: string; id:string;
    }) => p.origin === 'model'||p.id.startsWith('catalog:')) || [] }, { headers: { 'Cache-Control': 'private, no-store' } }); }
export async function PUT(request: Request) { const auth = await requireOwnerApi(); if (auth)
    return auth; const csrf = await requireCsrf(); if (csrf)
    return csrf; const parsed = settingsSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success)
    return Response.json({ error: 'Invalid taste settings' }, { status: 400 }); getDb().prepare('INSERT OR REPLACE INTO taste_profile VALUES(1,?,?)').run(JSON.stringify(parsed.data), new Date().toISOString()); return Response.json({ profile: buildProfile(getDb()) }); }
