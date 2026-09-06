import { getDb } from "@/src/lib/db";
export async function GET(){try{getDb().prepare("SELECT 1").get();return Response.json({status:"ok",database:"ok",worker:"separate-process"});}catch{return Response.json({status:"degraded",database:"error"},{status:503});}}

