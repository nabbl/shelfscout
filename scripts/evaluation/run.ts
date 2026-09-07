/** Synthetic controlled diagnostic. No network, model calls or real personal history. */
import fs from 'node:fs';
import { rankCandidates as baseline } from '../../tests/baseline-recommendations';
import { rankPool, selectBatch, type RankContext } from '../../src/lib/recommendation/rank';
import { workKey } from '../../src/lib/identity';
import type { CatalogBook, Preference, Profile } from '../../src/lib/recommendation/types';
const pref = (value: string, direction: 'prefer' | 'avoid' = 'prefer'): Preference => ({ id: value, dimension: 'theme', value, direction, origin: 'explicit', confidence: 'supported', support: ['synthetic-owner'], counterexamples: [] });
const p: Profile = { version: 'synthetic-reader-v1', preferences: [pref('memory'), pref('war', 'avoid')], evidence: [], settings: { preferences: [], disabled: [], includeReviews: false, rereads: false }, unknown: [] };
const books: CatalogBook[] = Array.from({ length: 30 }, (_, i) => ({ key: `/works/OL${i + 1}W`, title: `Synthetic work ${i + 1}`, author: `Author ${Math.floor(i / 2)}`, year: 2000, isbns: [], language: 'eng', coverUrl: null, subjects: i % 3 === 0 ? ['war'] : i % 3 === 1 ? ['adventure'] : ['memory'], description: `A story about ${i % 3 === 0 ? 'war' : i % 3 === 1 ? 'adventure' : 'memory'}.`, series: i < 4 ? 'Shared series' : null, strategies: ['synthetic'] }));
const c: RankContext = { known: new Set(), dismissed: new Set(), deferred: new Set(), saved: new Set(), requested: new Set(), exposed: new Set(), aliases: new Map(), mood: '', rereads: false };
const docs = books.map(b => ({ key: b.key, title: b.title, author_name: [b.author], subject: b.subjects }));
const old = baseline(docs, c.known, c.dismissed, ['Synthetic beloved'], '', ['war']);
const current = selectBatch(rankPool(books, p, c));
const oldNext = baseline(docs, c.known, c.dismissed, ['Synthetic beloved'], '', ['war']);
const next = selectBatch(rankPool(books, p, { ...c, exposed: new Set(current.map(b => b.catalogKey)) }));
const negativeRemoved = { ...p, preferences: [pref('war')] };
const key = workKey('Different edition title', 'Original author');
const aliasContext = { ...c, known: new Set([key]), aliases: new Map([[books[0].key, [key]]]) };
const top = (list: {
    subjects: string[];
}[], subject: string) => list.slice(0, 3).filter(b => b.subjects.includes(subject)).length;
const artifacts = { label: 'Synthetic model-free controlled diagnostics; not live AI quality', dataset: { works: 30, authors: 15, reader: 'prefers memory, avoids war; counterfactual mood adventure' }, baseline: 'Frozen previous production rankCandidates implementation', metrics: { top3PositiveSubject: { baseline: top(old, 'memory'), new: top(current, 'memory') }, batchOverlap: { baseline: oldNext.filter(b => old.some(x => x.workKey === b.workKey)).length, new: next.filter(b => current.some(x => x.catalogKey === b.catalogKey)).length }, distinctAuthors: { baseline: new Set(old.map(b => b.author)).size, new: new Set(current.map(b => b.author)).size }, moodAdventureTop3: { baseline: top(baseline(docs, c.known, c.dismissed, ['Synthetic beloved'], 'adventure', ['war']), 'adventure'), new: top(selectBatch(rankPool(books, p, { ...c, mood: 'adventure' })), 'adventure') }, positiveCounterfactualWarTop3: { new: top(selectBatch(rankPool(books, negativeRemoved, c)), 'war') }, verifiedAliasKnownReadExcluded: { baseline: !baseline(docs, aliasContext.known, c.dismissed, [], '').some(b => b.title === books[0].title), new: !rankPool(books, p, aliasContext).some(b => b.catalogKey === books[0].key) }, unsupportedFavoriteRelationshipClaims: { baseline: old.filter(b => b.why.includes('Synthetic beloved')).length, new: current.filter(b => b.why.includes('Synthetic beloved')).length } }, batches: { baseline: old.map(b => b.title), new: current.map(b => b.title), next: next.map(b => b.title) }, heldOut: { status: 'not run: no real reading-history input supplied', leakagePolicy: 'Any future history evaluation must partition before profile construction AND discovery. Catalog metadata may be independently retrieved for held-out works, but held-out ratings, reviews and shelves must not influence profile, queries or candidate selection.' }, limitations: ['Synthetic labels encode intended behavior; these diagnostics do not estimate enjoyment.', 'Same supplied pool isolates ranking; no conclusion about live catalog retrieval recall or AI reasoning.', 'No arbitrary pass threshold: raw counts and batch titles are reported.', 'Historical exposure/popularity confounds offline ranking; randomized prospective owner feedback is needed.'] };
fs.mkdirSync('docs/evaluation', { recursive: true });
fs.writeFileSync('docs/evaluation/synthetic.json', JSON.stringify(artifacts, null, 2) + '\n');
console.log(JSON.stringify(artifacts.metrics, null, 2));
