import { describe, expect, it } from 'vitest';
import { createDatabase } from '../src/lib/db';
import { cacheGoodreadsImportSnapshot, withStoredRatings } from '../src/lib/ratings';
import { batchState, queueBatch } from '../src/lib/recommendation/engine';
import { rankPool } from '../src/lib/recommendation/rank';
import type { Candidate } from '../src/lib/recommendations';
import type { CatalogBook, Profile } from '../src/lib/recommendation/types';

const book: CatalogBook = { key: '/works/OL1W', title: 'The Remembered City', author: 'Test Author', year: 2000, isbns: [], language: 'eng', coverUrl: null, subjects: ['memory'], description: 'A city where memories disappear.', series: null, strategies: [] };
const profile: Profile = { version: 'test', evidence: [], unknown: [], settings: { preferences: [], disabled: [], includeReviews: false, rereads: false, allowSeries: true, hiddenMoods: [] }, preferences: [{ id: 'memory', dimension: 'theme', value: 'memory', direction: 'prefer', origin: 'explicit', confidence: 'supported', support: ['owner'], counterexamples: [] }] };
const context = { known: new Set<string>(), dismissed: new Set<string>(), deferred: new Set<string>(), saved: new Set<string>(), requested: new Set<string>(), exposed: new Set<string>(), aliases: new Map<string, string[]>(), mood: '', rereads: false };
const candidate = () => rankPool([book], profile, context)[0];

describe('recommendation explanations and community ratings', () => {
  it('uses a book-specific model interpretation and omits unsupported generic caveats', () => {
    const [result] = rankPool([book], profile, context, [{ key: book.key, matches: [{ preferenceId: 'memory', quote: 'memories disappear', field: 'description', interpretation: 'The disappearing memories connect with your interest in memory.' }], risks: [], mood: null }]);
    expect(result.why).toContain('The disappearing memories connect with your interest in memory.');
    expect(result.evidence[0].catalogQuote).toBe('memories disappear');
    expect(result.caveat).toBe('');
    expect(result.batchReason).toBe('');
  });
  it('keeps an evidenced tradeoff visible', () => {
    const [result] = rankPool([book], profile, context, [{ key: book.key, matches: [], risks: [{ preferenceId: 'memory', quote: 'memories disappear', field: 'description', interpretation: 'Loss of memory may be a difficult aspect of this story.' }], mood: null }]);
    expect(result.caveat).toContain('Loss of memory');
  });
  it('reads imported Goodreads averages into an existing batch without overwriting Amazon data', () => {
    const db = createDatabase(':memory:');
    const item = candidate();
    const id = queueBatch(db, { mood: '', mode: 'refresh', rereads: false });
    db.prepare("UPDATE recommendation_batches SET status='complete',result_json=?,completed_at=? WHERE id=?").run(JSON.stringify({ items: [item] }), new Date().toISOString(), id);
    cacheGoodreadsImportSnapshot(db, { workKey: item.workKey, title: item.title, author: item.author, rating: 4.17 });
    db.prepare('INSERT INTO companion_ratings VALUES(?,?,?)').run('unrelated-work', 1, '2026');
    const result = batchState(db).last.items[0] as Candidate;
    expect(result.ratings.goodreads.rating).toBe(4.17);
    expect(result.ratings.goodreads.status).toBe('import_snapshot');
    expect(result.ratings.goodreads.freshness).toContain('original rating date unknown');
    expect(result.ratings.amazon).toEqual(item.ratings.amazon);
    expect(JSON.parse((db.prepare('SELECT result_json FROM recommendation_batches WHERE id=?').get(id) as {result_json:string}).result_json).items[0].ratings.goodreads.rating).toBeNull();
    db.close();
  });
  it('uses resolved aliases and withholds ratings for ambiguous identities', () => {
    const db = createDatabase(':memory:'); const item = candidate();
    cacheGoodreadsImportSnapshot(db, { workKey: 'imported-work', title: 'Alternate title', author: item.author, rating: 3.85 });
    expect(withStoredRatings(db, item).ratings.goodreads.rating).toBeNull();
    db.prepare('INSERT INTO work_aliases VALUES(?,?,?)').run('imported-work', item.catalogKey, 'Verified alias');
    expect(withStoredRatings(db, item).ratings.goodreads.rating).toBe(3.85);
    db.prepare('INSERT INTO identity_conflicts VALUES(?,?,?,NULL,?)').run(item.catalogKey, item.title, '[]', '2026');
    expect(withStoredRatings(db, item).ratings.goodreads.rating).toBeNull();
    db.close();
  });
  it('does not display zero as a community rating', () => {
    const db = createDatabase(':memory:'); const item = candidate();
    cacheGoodreadsImportSnapshot(db, { workKey: item.workKey, title: item.title, author: item.author, rating: 0 });
    expect(withStoredRatings(db, item).ratings.goodreads.rating).toBeNull();
    db.close();
  });
});
