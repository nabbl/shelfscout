import { getDb } from "@/src/lib/db";
import { requireOwnerApi } from "@/src/lib/auth";
export async function GET(request:Request){const auth=await requireOwnerApi();if(auth)return auth;const q=new URL(request.url).searchParams.get("q")?.trim()||"";const rows=q?getDb().prepare("SELECT id,title,author,personal_rating,exclusive_status,date_read,shelves_json,isbn13,isbn_valid FROM reading_records WHERE title LIKE ? ESCAPE '\\' OR author LIKE ? ESCAPE '\\' ORDER BY date_read DESC LIMIT 200").all(`%${q.replace(/[%_\\]/g,"\\$&")}%`,`%${q.replace(/[%_\\]/g,"\\$&")}%`):getDb().prepare("SELECT id,title,author,personal_rating,exclusive_status,date_read,shelves_json,isbn13,isbn_valid FROM reading_records ORDER BY date_read DESC LIMIT 200").all();return Response.json({items:rows});}

