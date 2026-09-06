import fs from "node:fs";
import { getDb } from "@/src/lib/db";
import { importGoodreadsRows, parseGoodreadsCsv } from "@/src/lib/goodreads";
import { requireCsrf, requireOwnerApi } from "@/src/lib/auth";
export async function POST(_r:Request,{params}:{params:Promise<{id:string}>}){const auth=await requireOwnerApi();if(auth)return auth;const csrf=await requireCsrf();if(csrf)return csrf;const {id}=await params;const db=getDb();const item=db.prepare("SELECT * FROM imports WHERE id=?").get(id) as {stored_path:string;status:string}|undefined;if(!item)return Response.json({error:"Import preview not found"},{status:404});if(item.status==="committed"){const counts=db.prepare("SELECT disposition,count(*) count FROM import_rows WHERE import_id=? GROUP BY disposition").all(id);return Response.json({idempotent:true,counts});}const parsed=parseGoodreadsCsv(fs.readFileSync(item.stored_path));const report=importGoodreadsRows(db,id,parsed.rows);db.prepare("UPDATE imports SET status='committed',committed_at=? WHERE id=?").run(new Date().toISOString(),id);return Response.json({report});}

