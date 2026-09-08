import { z } from 'zod';
import { getDb } from '@/src/lib/db';
import { requireOwnerApi, requireCsrf } from '@/src/lib/auth';
import { listHistory, setReadingStatus } from '@/src/lib/history';

export async function GET(request: Request) {
  const auth = await requireOwnerApi(); if (auth) return auth;
  const query = new URL(request.url).searchParams.get('q')?.trim() || '';
  return Response.json({ items: listHistory(getDb(), query) }, { headers: { 'Cache-Control': 'private, no-store' } });
}
export async function PATCH(request: Request) {
  const auth = await requireOwnerApi(); if (auth) return auth;
  const csrf = await requireCsrf(); if (csrf) return csrf;
  const parsed = z.object({ workKey: z.string().min(16).max(128), status: z.enum(['read', 'to-read', 'currently-reading', 'dnf', 'on-hold']).nullable() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Choose a valid reading status.' }, { status: 400 });
  if (!setReadingStatus(getDb(), parsed.data.workKey, parsed.data.status)) return Response.json({ error: 'Book not found in reading history.' }, { status: 404 });
  return Response.json({ ok: true });
}
