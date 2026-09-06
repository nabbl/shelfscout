import { getDb } from "@/src/lib/db";
import { requireOwnerApi } from "@/src/lib/auth";
export async function GET(_r:Request,{params}:{params:Promise<{id:string}>}){const auth=await requireOwnerApi();if(auth)return auth;const {id}=await params;return Response.json({items:getDb().prepare("SELECT status,detail,created_at FROM acquisition_events WHERE acquisition_id=? ORDER BY id").all(id)});}
