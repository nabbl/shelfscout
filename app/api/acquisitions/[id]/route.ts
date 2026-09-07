import { z } from 'zod';
import { requireCsrf, requireOwnerApi } from '@/src/lib/auth';
import { getDb } from '@/src/lib/db';
import { updateAcquisition } from '@/src/lib/acquisition';
const schema = z.discriminatedUnion('action', [z.object({ action: z.literal('recheck') }), z.object({ action: z.literal('select_release'), releaseIndex: z.number().int().min(0).max(499) })]);
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireOwnerApi(); if (auth) return auth;
  const csrf = await requireCsrf(); if (csrf) return csrf;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Choose a valid acquisition action.' }, { status: 400 });
  try { updateAcquisition(getDb(), (await context.params).id, parsed.data.action, 'releaseIndex' in parsed.data ? parsed.data.releaseIndex : undefined); return Response.json({ ok: true }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Could not update acquisition.' }, { status: 409 }); }
}
