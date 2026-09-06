import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type ShelfDb = Database.Database;
let singleton: ShelfDb | undefined;

export function createDatabase(filename = process.env.SHELFSCOUT_DB || path.join(process.env.DATA_DIR || "data", "shelfscout.sqlite")) {
  if (filename !== ":memory:") fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  const migration = fs.readFileSync(path.join(process.cwd(), "db/migrations/0001_initial.sql"), "utf8");
  db.exec(migration);
  db.pragma("optimize");
  return db;
}

export function getDb() {
  singleton ??= createDatabase();
  return singleton;
}

export function closeDbForTests() { singleton?.close(); singleton = undefined; }

