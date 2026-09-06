import { getDb } from "@/src/lib/db";
import { requireOwnerApi } from "@/src/lib/auth";
export async function GET(){const auth=await requireOwnerApi();if(auth)return auth;const db=getDb();const data={version:1,exportedAt:new Date().toISOString(),history:db.prepare("SELECT * FROM reading_records").all(),feedback:db.prepare("SELECT * FROM feedback").all(),identityMappings:db.prepare("SELECT id,source,source_book_id,work_key,edition_key FROM reading_records").all(),taste:{derived:true,note:"Taste is derived from ratings, shelves, reviews and feedback."}};return Response.json(data,{headers:{"Content-Disposition":`attachment; filename="shelfscout-export-${new Date().toISOString().slice(0,10)}.json"`,"Cache-Control":"private, no-store"}});}

