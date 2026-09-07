import { normalize } from '../identity';
import { enrichHistory } from './history-evidence';
import { randomUUID } from 'node:crypto';
import type { ShelfDb } from '../db';
import { activeFeedback, buildProfile } from './profile';
import { modelConfigured, interpretProfile, planDiscovery, assessCandidates } from './ai';
import { defaultStrategies, searchCatalog, enrichBook, resolveAliases } from './catalog';
import { rankPool, selectBatch, type RankContext } from './rank';
import type { CatalogBook, Assessment } from './types';
export type BatchInput = {
    mood: string;
    mode: 'more' | 'refresh';
    rereads: boolean;
};
export function queueBatch(db: ShelfDb, input: BatchInput) { return db.transaction(() => { const active = db.prepare("SELECT id FROM recommendation_batches WHERE status IN ('queued','running') ORDER BY created_at DESC LIMIT 1").get() as {
    id: string;
} | undefined; if (active)
    return active.id; const id = randomUUID(), job = randomUUID(), now = new Date().toISOString(); db.prepare('INSERT INTO recommendation_batches(id,job_id,input_json,status,stage,created_at) VALUES(?,?,?,?,?,?)').run(id, job, JSON.stringify(input), 'queued', 'Waiting for recommendation worker', now); db.prepare('INSERT INTO jobs(id,type,payload_json,status,run_after,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(job, 'recommendation', JSON.stringify({ id }), 'queued', now, now, now); return id; })(); }
export function batchState(db: ShelfDb) {
    const active = db.prepare("SELECT id,status,stage,error,input_json FROM recommendation_batches ORDER BY created_at DESC LIMIT 1").get();
    const last = db.prepare("SELECT id,result_json,input_json,completed_at FROM recommendation_batches WHERE status='complete' ORDER BY completed_at DESC LIMIT 1").get() as {
        id: string;
        result_json: string;
        input_json: string;
        completed_at: string;
    } | undefined;
    if (!last)
        return { active, last: null };
    const result = JSON.parse(last.result_json);
    const context = rankContext(db, JSON.parse(last.input_json));
    result.items = result.items.filter((b: {
        workKey: string;
        catalogKey: string;
    }) => { const keys = [b.workKey, b.catalogKey, ...(context.aliases.get(b.catalogKey) || [])]; return !keys.some(k => context.dismissed.has(k) || context.deferred.has(k) || context.saved.has(k) || context.requested.has(k) || (!context.rereads && context.known.has(k))); });
    return { active, last: { id: last.id, ...result, completedAt: last.completed_at } };
}
export function rankContext(db: ShelfDb, input: BatchInput): RankContext {
    const feedback = activeFeedback(db);
    const aliases = new Map<string, string[]>();
    for (const row of db.prepare('SELECT work_key,catalog_key FROM work_aliases').all() as {
        work_key: string;
        catalog_key: string;
    }[])
        aliases.set(row.catalog_key, [...(aliases.get(row.catalog_key) || []), row.work_key]);
    const keys = (action: string) => new Set(feedback.filter(f => f.action === action).map(f => f.work_key));
    const known = new Set((db.prepare("SELECT DISTINCT work_key FROM reading_records WHERE exclusive_status IN ('read','currently-reading') OR read_count>0").all() as {
        work_key: string;
    }[]).map(r => r.work_key));
    for (const k of keys('already_read'))
        known.add(k);
    for (const r of db.prepare('SELECT work_key FROM companion_ratings').all() as {
        work_key: string;
    }[])
        known.add(r.work_key);
    const last = db.prepare("SELECT id FROM recommendation_batches WHERE status='complete' ORDER BY completed_at DESC LIMIT 1").get() as {
        id: string;
    } | undefined;
    const exposures = db.prepare('SELECT * FROM recommendation_exposures WHERE created_at>?').all(new Date(Date.now() - 90 * 86400000).toISOString()) as {
        batch_id: string;
        author: string;
        work_key: string;
        catalog_key: string;
    }[];
    const authorExposure=new Map<string,number>();for(const e of exposures)authorExposure.set(normalize(e.author),(authorExposure.get(normalize(e.author))||0)+1);
    const ambiguous=new Set((db.prepare('SELECT catalog_key FROM identity_conflicts WHERE resolution IS NULL').all() as {catalog_key:string}[]).map(r=>r.catalog_key));
    return { ambiguous,authorExposure,known, dismissed: keys('not_interested'), deferred: new Set(feedback.filter(f => f.action === 'not_now' && Date.parse(f.created_at) > Date.now() - 30 * 86400000).map(f => f.work_key)), saved: keys('saved'), requested: new Set([...keys('get_book'), ...(db.prepare("SELECT work_key FROM acquisitions WHERE status NOT IN ('failed','cancelled')").all() as {
                work_key: string;
            }[]).map(r => r.work_key)]), exposed: new Set(exposures.filter(e => input.mode === 'more' || e.batch_id !== last?.id).flatMap(e => [e.work_key, e.catalog_key])), aliases, mood: input.mood, rereads: input.rereads };
}
export async function generateBatch(db: ShelfDb, id: string) {
    const row = db.prepare('SELECT * FROM recommendation_batches WHERE id=?').get(id) as {
        input_json: string;
        status: string;
    } | undefined;
    if (!row || row.status === 'complete')
        return;
    const input = JSON.parse(row.input_json) as BatchInput;
    const stage = (value: string) => db.prepare("UPDATE recommendation_batches SET status='running',stage=?,error=NULL WHERE id=?").run(value, id);
    const warnings: string[] = [];
    try {
        db.prepare('DELETE FROM recommendation_cache WHERE expires_at<=?').run(new Date().toISOString());
        stage('Building evidence profile');
        let profile = buildProfile(db);
        const history=await enrichHistory(db,profile,stage);profile=history.profile;if(history.failed)warnings.push(`${history.failed} historical works could not be unambiguously enriched; their missing catalog traits remain unknown.`);
        let aiStages = 0;
        if (modelConfigured()) {
            try {
                profile = await interpretProfile(db, profile);
                aiStages++;
            }
            catch {
                warnings.push('AI taste interpretation unavailable or invalid; using local evidence.');
            }
        }
        else
            warnings.push('No model configured: literal catalog matching and exploration only.');
        stage('Planning complementary catalog searches');
        let strategies = defaultStrategies(profile, input.mood);
        if (modelConfigured())
            try {
                const plan = await planDiscovery(db, profile, input.mood);
                strategies = [...plan.strategies, ...strategies].filter((s, i, a) => a.findIndex(x => x.query === s.query) === i).slice(0, 12);
                aiStages++;
            }
            catch {
                warnings.push('AI discovery planning unavailable or invalid; using evidence-driven searches.');
            }
        const count = (db.prepare("SELECT COUNT(*) AS n FROM recommendation_batches WHERE status='complete'").get() as {
            n: number;
        }).n;
        const page = input.mode === 'more' ? 1 + Math.floor(count / 2) % 5 : 1;
        const byKey = new Map<string, CatalogBook>();
        // Sequential searches respect the public catalog's modest request budget. No arbitrary model URLs are fetched.
        for (let i = 0; i < strategies.length; i++) {
            stage(`Searching catalog ${i + 1}/${strategies.length}`);
            try {
                for (const b of await searchCatalog(db, strategies[i], page)) {
                    const previous = byKey.get(b.key);
                    byKey.set(b.key, previous ? { ...previous, strategies: [...new Set([...previous.strategies, ...b.strategies])] } : b);
                }
            }
            catch {
                warnings.push(`Catalog search ${i + 1} failed; other searches retained.`);
            }
        }
        if (!byKey.size)
            throw new Error('No catalog candidates were available. Check catalog connectivity and retry.');
        resolveAliases(db, [...byKey.values()]);
        const context = rankContext(db, input);
        const eligible = new Set(rankPool([...byKey.values()], profile, context).map(b => b.catalogKey));
        // Round-robin across discovery strategies prevents preliminary lexical ranking from starving exploration/AI assessment.
        const pool: CatalogBook[] = [];
        for (let offset = 0; offset < 40 && pool.length < 60; offset++)
            for (const strategy of strategies) {
                const candidate = [...byKey.values()].filter(b => eligible.has(b.key) && b.strategies.includes(strategy.query))[offset];
                if (candidate && !pool.some(b => b.key === candidate.key))
                    pool.push(candidate);
                if (pool.length >= 60)
                    break;
            }
        const enriched: CatalogBook[] = [];
        for (let i = 0; i < pool.length; i++) {
            stage(`Reading catalog evidence ${i + 1}/${pool.length}`);
            try {
                enriched.push(await enrichBook(db, pool[i]));
            }
            catch {
                enriched.push(pool[i]);
                warnings.push(`Description unavailable for ${pool[i].title}; subject evidence only.`);
            }
        }
        stage('Assessing preferences, mood and tradeoffs');
        const assessments: Assessment[] = [];
        if (modelConfigured())
            for (let i = 0; i < enriched.length; i += 12) {
                try {
                    assessments.push(...await assessCandidates(db, profile, input.mood, enriched.slice(i, i + 12)));
                    aiStages++;
                }
                catch {
                    warnings.push(`AI candidate assessment ${1 + i / 12} unavailable or invalid; literal evidence retained.`);
                }
            }
        const ranked = rankPool(enriched, profile, context, assessments);
        const items = selectBatch(ranked);
        const result = { items, profile, strategies, warnings: [...new Set(warnings)], rankingAdapter: aiStages ? 'AI-assisted with validated evidence (see stage warnings)' : 'deterministic evidence fallback', diagnostics: { catalogPool: byKey.size, eligible: eligible.size, assessed: enriched.length, modelAssessed: assessments.length, selected: items.length }, mood: input.mood, mode: input.mode };
        const now = new Date().toISOString();
        db.transaction(() => { db.prepare("UPDATE recommendation_batches SET status='complete',stage='Complete',result_json=?,completed_at=? WHERE id=?").run(JSON.stringify(result), now, id); for (const b of items)
            db.prepare('INSERT OR IGNORE INTO recommendation_exposures VALUES(?,?,?,?,?)').run(id, b.workKey, b.catalogKey, b.author, now); })();
    }
    catch (error) {
        db.prepare("UPDATE recommendation_batches SET status='failed',stage='Failed; last successful batch retained',error=? WHERE id=?").run(error instanceof Error ? error.message : 'Recommendation job failed', id);
        throw error;
    }
}
