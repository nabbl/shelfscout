/** Isolated authenticated browser fixture; never opens the owner's database or integrations. */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import { createDatabase } from '../src/lib/db';
import { buildProfile, hash } from '../src/lib/recommendation/profile';
import { defaultStrategies } from '../src/lib/recommendation/catalog';
const dir = mkdtempSync(join(tmpdir(), 'shelfscout-browser-'));
const filename = join(dir, 'fixture.sqlite');
const db = createDatabase(filename);
const preference = { id: 'owner:memory', dimension: 'theme', value: 'memory', direction: 'prefer', origin: 'explicit', confidence: 'supported', support: ['owner'], counterexamples: [] };
db.prepare('INSERT INTO taste_profile VALUES(1,?,?)').run(JSON.stringify({ preferences: [preference], disabled: [], includeReviews: false, rereads: false }), new Date().toISOString());
const docs = Array.from({ length: 40 }, (_, i) => ({ key: `/works/OL${i + 1}W`, title: `Synthetic browser book ${i + 1}`, author_name: [`Synthetic Author ${i + 1}`], subject: ['memory'], language: ['eng'] }));
const cache = (key: string, value: unknown) => db.prepare('INSERT OR REPLACE INTO recommendation_cache VALUES(?,?,?)').run(key, JSON.stringify(value), new Date(Date.now() + 86400000).toISOString());
const fixtureProfile=buildProfile(db);fixtureProfile.preferences.push({...preference,id:"owner:adventure",value:"adventure",dimension:"theme",direction:"prefer",origin:"explicit",confidence:"supported"});
for (const mood of ['', 'adventure'])
    for (const strategy of defaultStrategies(fixtureProfile, mood))
        for (let page = 1; page <= 5; page++) {
            const params = new URLSearchParams({ q: strategy.query, fields: 'key,title,author_name,first_publish_year,cover_i,isbn,language,subject,series_key,series_name,series_position', limit: '40', page: String(page) });
            cache(`catalog-v3:${hash(params.toString())}`, { docs });
        }
for (const d of docs)
    cache(`work-v2:${d.key}`, { key: d.key, title: d.title, description: 'A synthetic fixture story about memory.', subjects: ['memory'] });
db.close();
const env = { ...process.env, DEMO_MODE: 'false', SHELFSCOUT_DB: filename, DATA_DIR: dir, OWNER_PASSWORD_HASH: bcrypt.hashSync('browser-test-password', 4), SESSION_SECRET: 'isolated-browser-test-session-secret-at-least-32-characters', MODEL_NAME: '', MODEL_BASE_URL: '', MODEL_API_KEY: '', BOOKORBIT_URL: '', BOOKORBIT_TOKEN: '', BOOKORBIT_USERNAME: '', BOOKORBIT_PASSWORD: '', BOOKORBIT_PASSWORD_FILE: '', SHELFMARK_URL: '' };
const children = [spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--port', '3102'], { stdio: 'inherit', env }), spawn(process.execPath, ['--import', 'tsx', 'server/worker.ts'], { stdio: 'inherit', env })];
let closing = false;
function stop() { if (closing)
    return; closing = true; for (const child of children)
    child.kill('SIGTERM'); setTimeout(() => { rmSync(dir, { recursive: true, force: true }); process.exit(0); }, 1000).unref(); }
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
for (const child of children)
    child.on('exit', () => { if (!closing)
        stop(); });
