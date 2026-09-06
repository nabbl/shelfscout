import { z } from 'zod';
import { getDb } from '@/src/lib/db';
import { requireOwnerApi, requireCsrf } from '@/src/lib/auth';
import { batchState, queueBatch } from '@/src/lib/recommendation/engine';
const schema = z.object({ mood: z.string().max(160).default(''), mode: z.enum(['more', 'refresh']).default('more'), rereads: z.boolean().default(false) });
export async function GET() { const auth = await requireOwnerApi(); if (auth)
    return auth; return Response.json(batchState(getDb()), { headers: { 'Cache-Control': 'private, no-store' } }); }
export async function POST(request: Request) { const auth = await requireOwnerApi(); if (auth)
    return auth; const csrf = await requireCsrf(); if (csrf)
    return csrf; const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success)
    return Response.json({ error: 'Invalid batch settings' }, { status: 400 }); return Response.json({ id: queueBatch(getDb(), parsed.data) }, { status: 202 }); }
