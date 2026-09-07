import './load-env';
import { getDb } from "../src/lib/db";
getDb().pragma("optimize");
console.log("ShelfScout database is ready.");
