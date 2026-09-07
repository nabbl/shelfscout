import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase } from '../src/lib/db';
import { recoverAcquisitions } from '../src/lib/acquisition';
it('additively upgrades an old database, preserves uncertain and pending requests, and restores missing jobs', () => {
  const dir=mkdtempSync(join(tmpdir(),'shelfscout-migration-')),filename=join(dir,'old.sqlite');
  try {
    const old=new Database(filename);old.exec(readFileSync('db/migrations/0001_initial.sql','utf8'));
    const insert=old.prepare("INSERT INTO acquisitions(id,work_key,edition_key,title,language,preferred_formats_json,status,upstream_request_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)");
    for(const [id,status,request] of [['pending','downloading','41'],['uncertain','needs_attention',null],['finished','ready_for_kobo','42']])insert.run(id,id,id,'Legacy Book','eng','["epub"]',status,request,'2026-09-01','2026-09-01');
    old.prepare("INSERT INTO acquisition_events(acquisition_id,status,detail,created_at) VALUES('pending','downloading','Legacy event','2026-09-01')").run();old.close();
    const db=createDatabase(filename);recoverAcquisitions(db);recoverAcquisitions(db);
    expect(db.prepare('SELECT count(*) n FROM acquisitions').get()).toEqual({n:3});
    expect(db.prepare('SELECT count(*) n FROM acquisition_flows').get()).toEqual({n:0});
    expect(db.prepare('SELECT count(*) n FROM jobs').get()).toEqual({n:2});
    expect(db.prepare('SELECT detail FROM acquisition_events').get()).toEqual({detail:'Legacy event'});
    expect(db.prepare("SELECT upstream_request_id FROM acquisitions WHERE id='pending'").get()).toEqual({upstream_request_id:'41'});db.close();
    createDatabase(filename).close();
  } finally {rmSync(dir,{recursive:true,force:true});}
});
