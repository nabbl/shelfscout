import { createHash } from 'node:crypto';
import type { ShelfDb } from '../db';
import { normalize } from '../identity';
import { settingsSchema, type Evidence, type Preference, type Profile } from './types';
export const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function readSettings(db: ShelfDb) { const row = db.prepare('SELECT settings_json FROM taste_profile WHERE id=1').get() as {
    settings_json: string;
} | undefined; return settingsSchema.parse(row ? JSON.parse(row.settings_json) : {}); }
export function activeFeedback(db: ShelfDb) { return db.prepare('SELECT f.* FROM feedback f LEFT JOIN feedback_undo u ON u.feedback_id=f.id WHERE u.feedback_id IS NULL ORDER BY f.id DESC').all() as {
    id: number;
    work_key: string;
    action: string;
    reason: string | null;
    candidate_json: string | null;
    created_at: string;
}[]; }
export function buildProfile(db: ShelfDb): Profile {
    const settings = readSettings(db);
    const rows = db.prepare('SELECT r.*, COALESCE(c.rating,r.personal_rating) AS effective_rating FROM reading_records r LEFT JOIN companion_ratings c ON c.work_key=r.work_key ORDER BY date_read DESC,id DESC').all() as Record<string, unknown>[];
    const all: Evidence[] = rows.map(r => ({ id: `reading:${r.id}`, workKey: String(r.work_key), title: String(r.title), author: String(r.author || ''), rating: r.effective_rating == null ? null : Number(r.effective_rating), status: String(r.exclusive_status || 'unknown'), shelves: JSON.parse(String(r.shelves_json)), date: r.date_read ? String(r.date_read) : null, ...(settings.includeReviews && r.review ? { review: String(r.review).slice(0, 1800) } : {}) }));
    const feedback = activeFeedback(db);
    const ratings = db.prepare('SELECT * FROM companion_ratings').all() as {
        work_key: string;
        rating: number;
    }[];
    for (const f of feedback) {
        const existing=all.find(e=>e.workKey===f.work_key);
        if(existing&&f.reason)existing.reason=[existing.reason,f.reason].filter(Boolean).join("; ").slice(0,1000);
        if (all.some(e => e.workKey === f.work_key) || all.some(e => e.id === `feedback:${f.work_key}`))
            continue;
        let c: Record<string, unknown> = {};
        try {
            c = JSON.parse(f.candidate_json || '{}');
        }
        catch { /* Legacy malformed feedback has no usable candidate metadata. */ }
        const rating = ratings.find(r => r.work_key === f.work_key)?.rating ?? null;
        all.push({ id: `feedback:${f.work_key}`, workKey: f.work_key, title: String(c.title || 'Feedback book'), author: String(c.author || ''), rating, status: f.action, shelves: [], date: f.created_at, reason: f.reason || undefined });
    }
    // Stratify recent and older positives/negatives, then unknown/DNF. Never interpret 0 or DNF as a negative rating.
    const sample: Evidence[] = [];
    for (const group of [all.filter(e => (e.rating || 0) >= 4), all.filter(e => e.rating !== null && e.rating <= 2), all.filter(e => e.rating === 3), all.filter(e => e.rating === null)]) {
        for (const e of [...group.slice(0, 6), ...group.filter((_, i) => i >= 6 && i % Math.max(1, Math.floor(group.length / 6)) === 0).slice(0, 6)])
            if (!sample.some(x => x.id === e.id))
                sample.push(e);
    }
    const signals = new Map<string, {
        positive: string[];
        negative: string[];
    }>();
    for (const e of all) {
        if (e.rating === null || e.rating === 3)
            continue;
        for (const shelf of e.shelves) {
            const v = normalize(shelf);
            if (!v || /^(read|to read|owned|currently reading|favorites|favourites|dnf)$/.test(v))
                continue;
            const s = signals.get(v) || { positive: [], negative: [] };
            (e.rating >= 4 ? s.positive : s.negative).push(e.id);
            signals.set(v, s);
        }
    }
    const inferred: Preference[] = [...signals].map(([value, s]) => ({ id: `shelf:${value}`, dimension: 'subject', value, direction: s.positive.length >= s.negative.length ? 'prefer' : 'avoid', origin: 'inferred', confidence: s.positive.length && s.negative.length ? 'conflicting' : Math.max(s.positive.length, s.negative.length) > 1 ? 'supported' : 'tentative', support: (s.positive.length >= s.negative.length ? s.positive : s.negative).slice(0, 16), counterexamples: (s.positive.length >= s.negative.length ? s.negative : s.positive).slice(0, 16) }));
    // Explicit corrections replace a matching inferred dimension/value; disabled inference IDs remain durable.
    const preferences = [...settings.preferences.map(p => ({ ...p, origin: 'explicit' as const, confidence: 'supported' as const, support: ['owner'], counterexamples: [] })), ...inferred.filter(p => !settings.disabled.includes(p.id) && !settings.preferences.some(x => normalize(x.value) === normalize(p.value)))].slice(0, 60);
    const supportIds = new Set(preferences.flatMap(p => [...p.support, ...p.counterexamples]));
    const evidence = [...sample, ...all.filter(e => supportIds.has(e.id) && !sample.some(x => x.id === e.id))];
    return { version: hash({ revision: 'taste-v2', preferences, evidence, settings }), preferences, evidence, settings, unknown: ['Prose, pacing, character focus, tone, structure, length and ambiguity remain unknown unless stated explicitly or supported by permitted review text.'] };
}
export function representative(profile: Profile) { return profile.evidence.slice(0, 48); }
