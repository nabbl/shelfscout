import fs from "node:fs";
import { getDb } from "@/src/lib/db";
import { requireOwnerApi } from "@/src/lib/auth";
export async function GET(_r:Request,{params}:{params:Promise<{id:string}>}){const auth=await requireOwnerApi();if(auth)return auth;const {id}=await params;const row=getDb().prepare("SELECT filename,stored_path FROM imports WHERE id=?").get(id) as {filename:string;stored_path:string}|undefined;if(!row||!fs.existsSync(row.stored_path))return Response.json({error:"Not found"},{status:404});return new Response(fs.readFileSync(row.stored_path),{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="${row.filename.replace(/["\r\n]/g,"")}"`,"Cache-Control":"private, no-store"}});}
