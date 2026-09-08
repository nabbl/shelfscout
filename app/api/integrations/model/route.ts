import { requireCsrf, requireOwnerApi } from '@/src/lib/auth';
import { testModelConnection } from '@/src/lib/model-connection';

export async function POST() {
  const auth = await requireOwnerApi(); if (auth) return auth;
  const csrf = await requireCsrf(); if (csrf) return csrf;
  try {
    return Response.json({ ok: true, ...await testModelConnection() });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'AI connection test failed. Please retry.' }, { status: 502 });
  }
}
