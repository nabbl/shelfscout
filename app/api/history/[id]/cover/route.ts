import { requireOwnerApi } from '@/src/lib/auth';
import { getDb } from '@/src/lib/db';
import { getHistoryBook } from '@/src/lib/history';
import { findHistoryCover } from '@/src/lib/history-cover';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOwnerApi(); if (auth) return auth;
  const { id } = await params;
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id))) return Response.json({ error: 'Invalid book.' }, { status: 400 });
  const book = getHistoryBook(getDb(), Number(id));
  if (!book) return Response.json({ error: 'Book not found.' }, { status: 404 });
  try {
    const coverUrl = await findHistoryCover(getDb(), book, AbortSignal.any([request.signal, AbortSignal.timeout(15000)]));
    return Response.json({ coverUrl }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'Cover lookup is temporarily unavailable.' }, { status: 502 });
  }
}
