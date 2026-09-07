/** Run only with an owner-supplied export and independently collected catalog pool. */
import fs from 'node:fs';
import { createDatabase } from '../../src/lib/db';
import { parseGoodreadsCsv } from '../../src/lib/goodreads';
import { buildProfile } from '../../src/lib/recommendation/profile';
import { resolveAliases } from '../../src/lib/recommendation/catalog';
import { rankPool } from '../../src/lib/recommendation/rank';
import { rankContext } from '../../src/lib/recommendation/engine';
import { rankCandidates as baseline } from '../../tests/baseline-recommendations';
import { workKey } from '../../src/lib/identity';
import type { CatalogBook } from '../../src/lib/recommendation/types';
const [historyPath, poolPath] = process.argv.slice(2);
if (!historyPath || !poolPath)
    throw new Error('Usage: npm run evaluate:heldout -- /private/history.csv /private/independent-catalog.json');
const parsed = parseGoodreadsCsv(fs.readFileSync(historyPath));
const rated = parsed.rows.filter(r => !r.errors.length && r.personalRating !== null && r.exclusiveStatus === 'read').sort((a, b) => (b.dateRead || '').localeCompare(a.dateRead || '') || a.workKey.localeCompare(b.workKey));
if (rated.length < 10)
    throw new Error('Insufficient rated read history for a temporal split (need at least 10; report sparse history separately).');
const held = rated.slice(0, Math.max(1, Math.floor(rated.length * 0.2)));
const heldKeys = new Set(held.map(r => r.workKey));
const heldIsbns = new Set(held.flatMap(r => [r.isbn13, r.isbn]).filter(Boolean));
// Split before creating any profile/query inputs. Remove alternate training editions of held-out works too.
const training = parsed.rows.filter(r => !heldKeys.has(r.workKey) && !heldIsbns.has(r.isbn13) && !heldIsbns.has(r.isbn));
const db = createDatabase(':memory:');
const insert = db.prepare("INSERT INTO reading_records(work_key,edition_key,title,author,isbn13,isbn_valid,personal_rating,exclusive_status,shelves_json,date_read,review,raw_json,source_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'{}','heldout-test','now','now')");
for (const r of training)
    insert.run(r.workKey, r.editionKey, r.title, r.author, r.isbn13, r.isbnValid ? 1 : 0, r.personalRating, r.exclusiveStatus, JSON.stringify(r.shelves), r.dateRead, r.review);
const profile = buildProfile(db);
const books = JSON.parse(fs.readFileSync(poolPath, 'utf8')) as CatalogBook[];
if (!Array.isArray(books) || books.some(b => !/^\/works\/OL\d+W$/.test(b.key) || !b.title || !b.author || !Array.isArray(b.subjects) || !Array.isArray(b.isbns) || typeof b.description !== 'string'))
    throw new Error('Independent catalog JSON must contain validated CatalogBook[] records.');
resolveAliases(db, books);
const context = rankContext(db, { mood: '', mode: 'more', rereads: false });
const ranked = rankPool(books, profile, context);
const old = baseline(books.map(b => ({ key: b.key, title: b.title, author_name: [b.author], subject: b.subjects })), context.known, context.dismissed, profile.evidence.filter(e => (e.rating || 0) >= 4).map(e => e.title), '', profile.preferences.filter(p => p.direction === 'avoid').map(p => p.value));
// Ratings enter only the metric computation below; they never enter profile, pool or ranking.
const ratingFor = (title: string, author: string) => held.find(h => h.workKey === workKey(title, author))?.personalRating ?? null;
const diagnostic = (items: {
    title: string;
    author: string;
}[]) => ({ evaluatedTop9: items.slice(0, 9).map((b, i) => ({ rank: i + 1, heldOutRating: ratingFor(b.title, b.author) })), heldOutPositivesInTop9: items.slice(0, 9).filter(b => (ratingFor(b.title, b.author) || 0) >= 4).length });
const report = { label: 'Offline held-out diagnostic; no model calls, no enjoyment guarantee', trainingRecords: training.length, heldOutRecords: held.length, catalogPool: books.length, heldOutCoverage: held.filter(h => books.some(b => workKey(b.title, b.author) === h.workKey)).length, baseline: diagnostic(old), new: diagnostic(ranked), limitations: ['Catalog pool provenance must be checked by the operator: collect it without held-out titles/ratings/reviews/shelves driving discovery.', 'Titles use exact normalized author/title matching for metrics; verified edition aliases may undercount coverage.', 'Temporal split may have low catalog coverage. Do not tune thresholds on this holdout.', 'Historical exposure and popularity confound this metric; prospective feedback is required.'] };
fs.mkdirSync('outputs', { recursive: true });
fs.writeFileSync('outputs/heldout-evaluation.json', JSON.stringify(report, null, 2) + '\n');
console.log('Wrote private aggregate diagnostics to outputs/heldout-evaluation.json');
db.close();
