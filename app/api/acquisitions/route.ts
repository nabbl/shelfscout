import { z } from "zod";
import { getDb } from "@/src/lib/db";
import { requireCsrf, requireOwnerApi } from "@/src/lib/auth";
import { publicAcquisitions, submitAcquisition, submitAcquisitions } from "@/src/lib/acquisition";
const schema=z.object({title:z.string().min(1).max(500),author:z.string().max(500).nullable().optional(),isbn13:z.string().regex(/^\d{13}$/).nullable().optional(),language:z.string().min(2).max(20),providerKey:z.string().max(50).nullable().optional(),providerId:z.string().max(255).nullable().optional(),coverUrl:z.string().url().nullable().optional(),publishedYear:z.number().int().min(0).max(9999).nullable().optional(),targetCollectionId:z.string().regex(/^[1-9]\d*$/)});
const batchSchema = z.object({ books: z.array(schema.omit({ targetCollectionId: true, language: true })).min(1).max(200), language: schema.shape.language, targetCollectionId: schema.shape.targetCollectionId });
export async function GET(){const auth=await requireOwnerApi();if(auth)return auth;return Response.json({items:publicAcquisitions(getDb())});}
export async function POST(request: Request) {
  const auth = await requireOwnerApi(); if (auth) return auth;
  const csrf = await requireCsrf(); if (csrf) return csrf;
  const parsed = z.union([batchSchema, schema]).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'A verified title, language and valid identifiers are required' }, { status: 400 });
  try {
    const input = parsed.data;
    if ('books' in input) return Response.json({ items: submitAcquisitions(getDb(), input.books.map(book => ({ ...book, language: input.language })), input.targetCollectionId) });
    return Response.json(await submitAcquisition(getDb(), input, input.targetCollectionId));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Request failed', reconciliationRequired: true }, { status: 502 }); }
}
