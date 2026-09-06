import { z } from "zod";
import { getDb } from "@/src/lib/db";
import { requireCsrf, requireOwnerApi } from "@/src/lib/auth";
const schema=z.object({workKey:z.string().min(16).max(128),action:z.enum(["already_read","not_interested","not_now","saved","get_book"]),reason:z.string().max(500).optional(),candidate:z.record(z.string(),z.unknown()).optional()});
export async function POST(request:Request){const auth=await requireOwnerApi();if(auth)return auth;const csrf=await requireCsrf();if(csrf)return csrf;const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return Response.json({error:"Invalid feedback"},{status:400});getDb().prepare("INSERT INTO feedback(work_key,action,reason,candidate_json,created_at) VALUES(?,?,?,?,?)").run(parsed.data.workKey,parsed.data.action,parsed.data.reason||null,parsed.data.candidate?JSON.stringify(parsed.data.candidate):null,new Date().toISOString());return Response.json({ok:true});}
