import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "@/src/lib/db";
import { parseGoodreadsCsv } from "@/src/lib/goodreads";
import { requireCsrf, requireOwnerApi } from "@/src/lib/auth";

export async function POST(request:Request){const auth=await requireOwnerApi();if(auth)return auth;const csrf=await requireCsrf();if(csrf)return csrf;
  const form=await request.formData();const file=form.get("file");if(!(file instanceof File))return Response.json({error:"Choose a Goodreads CSV file"},{status:400});if(file.size>25*1024*1024)return Response.json({error:"CSV exceeds the 25 MB limit"},{status:413});
  const bytes=Buffer.from(await file.arrayBuffer());let parsed;try{parsed=parseGoodreadsCsv(bytes);}catch(error){return Response.json({error:`Invalid CSV: ${error instanceof Error?error.message:"parse failed"}`},{status:400});}
  const id=randomUUID();const dir=path.join(process.env.DATA_DIR||"data","imports");fs.mkdirSync(dir,{recursive:true,mode:0o700});const stored=path.join(dir,`${id}.csv`);fs.writeFileSync(stored,bytes,{mode:0o600});
  const summary={total:parsed.rows.length,valid:parsed.rows.filter(r=>!r.errors.length).length,rejected:parsed.rows.filter(r=>r.errors.length).length,missingIds:parsed.rows.filter(r=>!r.sourceId).length,invalidIsbns:parsed.rows.filter(r=>(r.isbn||r.isbn13)&&!r.isbnValid).length,unknownColumns:parsed.headers.filter(h=>!["Book Id","Title","Author","Author l-f","Additional Authors","ISBN","ISBN13","My Rating","Average Rating","Publisher","Binding","Number of Pages","Year Published","Original Publication Year","Date Read","Date Added","Bookshelves","Bookshelves with positions","Exclusive Shelf","My Review","Spoiler","Private Notes","Read Count","Owned Copies"].includes(h)),sample:parsed.rows.slice(0,5).map(r=>({row:r.rowNumber,id:r.sourceId,title:r.title,author:r.author,rating:r.personalRating,status:r.exclusiveStatus,errors:r.errors}))};
  getDb().prepare("INSERT INTO imports(id,filename,stored_path,sha256,headers_json,preview_json,status,row_count,created_at) VALUES(?,?,?,?,?,?,?,?,?)").run(id,file.name,stored,createHash("sha256").update(bytes).digest("hex"),JSON.stringify(parsed.headers),JSON.stringify(summary),"previewed",parsed.rows.length,new Date().toISOString());return Response.json({id,summary,policy:"Reimport matches by Goodreads Book Id; source fields update, companion feedback is preserved, and missing rows are never deleted."});
}

