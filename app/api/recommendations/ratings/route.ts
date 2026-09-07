import { bookOrbitAuthenticationMode } from '@/src/lib/bookorbit-auth';
import { getDb } from '@/src/lib/db';
import { requireCsrf, requireOwnerApi } from '@/src/lib/auth';
import { queueRatingRefresh } from '@/src/lib/rating-refresh';

export async function POST() {
  const auth = await requireOwnerApi(); if (auth) return auth;
  const csrf = await requireCsrf(); if (csrf) return csrf;
  const db = getDb();
  const batch = db.prepare("SELECT id FROM recommendation_batches WHERE status='complete' ORDER BY completed_at DESC LIMIT 1").get() as {id:string} | undefined;
  if (!batch) return Response.json({error:'Generate recommendations first.'}, {status:400});
  try {
    if (!process.env.BOOKORBIT_URL || bookOrbitAuthenticationMode() === 'unconfigured') return Response.json({error:'Configure the BookOrbit URL and username/password (or a manual token), then restart ShelfScout.'}, {status:400});
  } catch (error) { return Response.json({error:error instanceof Error ? error.message : 'BookOrbit authentication is not configured.'}, {status:400}); }
  return Response.json({id:queueRatingRefresh(db, batch.id, true)}, {status:202});
}
