import { requireOwnerApi } from '@/src/lib/auth';
import { getDb } from '@/src/lib/db';
import { CatalogError } from '@/src/lib/recommendation/catalog';
import { browseSeries } from '@/src/lib/recommendation/series-browse';

export async function GET(request: Request) {
  const auth = await requireOwnerApi(); if (auth) return auth;
  const key = new URL(request.url).searchParams.get('work') || '';
  if (!/^\/works\/OL\d+W$/.test(key)) return Response.json({ error: 'A valid catalog work is required.' }, { status: 400 });
  try {
    return Response.json(await browseSeries(getDb(), key), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const message = error instanceof CatalogError ? error.message : 'The series lookup could not finish. Please retry; your book requests are unaffected.';
    console.warn('Series lookup failed', { work: key, error: error instanceof Error ? error.name : 'UnknownError', message: error instanceof CatalogError ? error.message : undefined });
    return Response.json({ error: message }, { status: 502, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
