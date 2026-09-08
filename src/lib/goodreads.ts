import { parse } from "csv-parse/sync";
import { createHash } from "node:crypto";
import { editionKey, workKey } from "./identity";
import { cacheGoodreadsImportSnapshot } from "./ratings";

export type ImportDisposition = "imported"|"updated"|"unchanged"|"rejected";
export interface ParsedGoodreadsRow {
  rowNumber:number; sourceId:string|null; title:string; author:string|null;
  isbnOriginal:string|null; isbn:string|null; isbn13Original:string|null; isbn13:string|null; isbnValid:boolean;
  personalRating:number|null; communityRatingSnapshot:number|null; shelves:string[]; exclusiveStatus:string|null;
  dateRead:string|null; dateAdded:string|null; datePrecision:string|null; review:string|null; readCount:number|null;
  raw:Record<string,string>; sourceHash:string; workKey:string; editionKey:string; errors:string[];
}

function unwrapSpreadsheetIdentifier(value?: string) {
  const raw = value?.trim() || "";
  const match = raw.match(/^="([^"]*)"$/);
  return { original: raw || null, parsed: (match ? match[1] : raw).trim() || null };
}
export function validIsbn(value:string|null) {
  if (!value) return false;
  const s=value.replace(/[-\s]/g,"");
  if (/^\d{13}$/.test(s)) { let sum=0; for(let i=0;i<12;i++) sum+=Number(s[i])*(i%2?3:1); return (10-sum%10)%10===Number(s[12]); }
  if (/^\d{9}[\dX]$/i.test(s)) { let sum=0; for(let i=0;i<10;i++) sum+=(10-i)*(s[i].toUpperCase()==="X"?10:Number(s[i])); return sum%11===0; }
  return false;
}
function nullableNumber(value?: string) { if (!value?.trim()) return null; const n=Number(value); return Number.isFinite(n)?n:null; }
function precision(value:string|null) { if(!value)return null; if(/^\d{4}$/.test(value))return "year"; if(/^\d{4}[-/]\d{1,2}$/.test(value))return "month"; return "day"; }

export function parseGoodreadsCsv(input: Buffer|string): {headers:string[];rows:ParsedGoodreadsRow[]} {
  const text=(Buffer.isBuffer(input)?input.toString("utf8"):input).replace(/^\uFEFF/,"");
  const records=parse(text,{bom:true,columns:true,skip_empty_lines:true,relax_column_count:true,relax_quotes:false}) as Record<string,string>[];
  const headers=records.length?Object.keys(records[0]):[];
  return { headers, rows:records.map((raw,index)=>{
    const title=(raw.Title||raw.title||"").trim(); const author=(raw.Author||raw.author||"").trim()||null;
    const sourceId=(raw["Book Id"]||raw.book_id||"").trim()||null;
    const i10=unwrapSpreadsheetIdentifier(raw.ISBN); const i13=unwrapSpreadsheetIdentifier(raw.ISBN13);
    const rating=nullableNumber(raw["My Rating"]); const personalRating=rating===0?null:rating;
    const communityRatingSnapshot=nullableNumber(raw["Average Rating"]);
    const exclusiveStatus=(raw["Exclusive Shelf"]||"").trim()||null;
    const shelves=(raw["Bookshelves"]||"").split(",").map(s=>s.trim()).filter(Boolean);
    const dateRead=(raw["Date Read"]||"").trim()||null; const dateAdded=(raw["Date Added"]||"").trim()||null;
    const errors:string[]=[]; if(!title)errors.push("missing title"); if(personalRating!==null&&(personalRating<1||personalRating>5))errors.push("personal rating outside 1–5");
    const normalizedIsbn=i10.parsed?.replace(/[-\s]/g,"")||null; const normalizedIsbn13=i13.parsed?.replace(/[-\s]/g,"")||null;
    const hash=createHash("sha256").update(JSON.stringify(raw)).digest("hex");
    return {rowNumber:index+2,sourceId,title,author,isbnOriginal:i10.original,isbn:normalizedIsbn,isbn13Original:i13.original,isbn13:normalizedIsbn13,isbnValid:validIsbn(normalizedIsbn13)||validIsbn(normalizedIsbn),personalRating,communityRatingSnapshot,shelves,exclusiveStatus,dateRead,dateAdded,datePrecision:precision(dateRead),review:(raw["My Review"]||"").trim()||null,readCount:nullableNumber(raw["Read Count"]),raw,sourceHash:hash,workKey:workKey(title,author),editionKey:editionKey({isbn13:normalizedIsbn13,isbn:normalizedIsbn,sourceId,title,author}),errors};
  })};
}

export function importGoodreadsRows(db: import("better-sqlite3").Database, importId:string, rows:ParsedGoodreadsRow[]) {
  const report={imported:0,updated:0,unchanged:0,rejected:0,missingIds:0,ambiguousMatches:0,total:rows.length,errors:[] as {row:number;reason:string}[]};
  const insert=db.prepare(`INSERT INTO reading_records(source_book_id,work_key,edition_key,title,author,isbn_original,isbn,isbn13_original,isbn13,isbn_valid,personal_rating,community_rating_snapshot,exclusive_status,shelves_json,date_read,date_added,date_precision,review,read_count,raw_json,source_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const update=db.prepare(`UPDATE reading_records SET title=?,author=?,isbn_original=?,isbn=?,isbn13_original=?,isbn13=?,isbn_valid=?,personal_rating=?,community_rating_snapshot=?,exclusive_status=?,shelves_json=?,date_read=?,date_added=?,date_precision=?,review=?,read_count=?,raw_json=?,source_hash=?,updated_at=? WHERE id=?`);
  const outcome=db.prepare(`INSERT INTO import_rows(import_id,row_number,reading_record_id,disposition,reason) VALUES(?,?,?,?,?)`);
  const tx=db.transaction(()=>{ for(const row of rows){
    if(!row.sourceId)report.missingIds++;
    if(row.errors.length){report.rejected++; const reason=row.errors.join("; ");report.errors.push({row:row.rowNumber,reason});outcome.run(importId,row.rowNumber,null,"rejected",reason);continue;}
    cacheGoodreadsImportSnapshot(db,{workKey:row.workKey,title:row.title,author:row.author,rating:row.communityRatingSnapshot});
    let existing=row.sourceId?db.prepare("SELECT * FROM reading_records WHERE source='goodreads' AND source_book_id=?").get(row.sourceId) as Record<string,unknown>|undefined:undefined;
    if(!existing&&!row.sourceId){const matches=db.prepare("SELECT * FROM reading_records WHERE edition_key=?").all(row.editionKey) as Record<string,unknown>[];if(matches.length===1)existing=matches[0];else if(matches.length>1)report.ambiguousMatches++;}
    if(existing&&existing.source_hash===row.sourceHash){report.unchanged++;outcome.run(importId,row.rowNumber,existing.id,"unchanged",null);continue;}
    const vals=[row.title,row.author,row.isbnOriginal,row.isbn,row.isbn13Original,row.isbn13,row.isbnValid?1:0,row.personalRating,row.communityRatingSnapshot,row.exclusiveStatus,JSON.stringify(row.shelves),row.dateRead,row.dateAdded,row.datePrecision,row.review,row.readCount,JSON.stringify(row.raw),row.sourceHash,new Date().toISOString()];
    if(existing){update.run(...vals,existing.id);report.updated++;outcome.run(importId,row.rowNumber,existing.id,"updated",existing.companion_updated_at?"source fields updated; companion feedback preserved":null);}
    else {const now=new Date().toISOString();const result=insert.run(row.sourceId,row.workKey,row.editionKey,...vals.slice(0,18),now,now);report.imported++;outcome.run(importId,row.rowNumber,result.lastInsertRowid,"imported",null);}
  }});tx();return report;
}
