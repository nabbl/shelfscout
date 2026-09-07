import { normalize, workKey } from '../identity';
import type { Candidate } from '../recommendations';
import type { CatalogBook, Profile, Assessment, Preference } from './types';
export type RankContext = {
    known: Set<string>;
    dismissed: Set<string>;
    deferred: Set<string>;
    saved: Set<string>;
    requested: Set<string>;
    exposed: Set<string>;
    aliases: Map<string, string[]>;
    mood: string;
    rereads: boolean;
    authorExposure?: Map<string,number>;
    ambiguous?: Set<string>;
};
export type RankedCandidate = Candidate & {
    catalogKey: string;
    description: string;
    series: string | null;
    batchReason: string;
    score: number;
    evidence: {
        preferenceId: string;
        preference: string;
        origin: string;
        support: string[];
        counterexamples: string[];
        catalogQuote: string;
        sourceUrl: string;
        interpretation?: string;
    }[];
    assessmentMode: string;
    identityStatus: string;
};
export function textMatch(text: string, value: string) { const hay = ` ${normalize(text)} `; const words = normalize(value).split(' ').filter(Boolean); return words.length > 0 && words.every(w => hay.includes(` ${w} `)); }
function strength(p: Preference) { return p.origin === 'explicit' ? 4 : p.confidence === 'conflicting' ? 0.5 : p.confidence === 'supported' ? 2 : 1; }
export function rankPool(books: CatalogBook[], profile: Profile, context: RankContext, assessments: Assessment[] = []): RankedCandidate[] {
    const scored: RankedCandidate[] = [];
    for (const b of books) {
        if(context.ambiguous?.has(b.key))continue;
        const wk = workKey(b.title, b.author);
        const identities = [wk, b.key, ...(context.aliases.get(b.key) || [])];
        const has = (set: Set<string>) => identities.some(k => set.has(k));
        if ((!context.rereads && has(context.known)) || has(context.dismissed) || has(context.deferred) || has(context.exposed) || has(context.saved) || has(context.requested))
            continue;
        const ai = assessments.find(a => a.key === b.key);
        const matched = new Map<string, {
            quote: string;
            interpretation?: string;
            negative: boolean;
        }>();
        for (const p of profile.preferences) {
            const quote = (p.dimension === 'author' && textMatch(b.author, p.value) ? b.author : '') || b.subjects.find(s => textMatch(s, p.value)) || (textMatch(b.description, p.value) ? b.description : '');
            if (quote)
                matched.set(p.id, { quote, negative: p.direction === 'avoid' });
        }
        if (ai)
            for (const [links, negative] of [[ai.matches, false], [ai.risks, true]] as const)
                for (const link of links) {
                    const p = profile.preferences.find(p => p.id === link.preferenceId);
                    if (p)
                        matched.set(p.id, { quote: link.quote, interpretation: link.interpretation, negative: negative || p.direction === 'avoid' });
                }
        let score = -Math.min(3, context.authorExposure?.get(normalize(b.author))||0);
        const evidence: RankedCandidate['evidence'] = [];
        const risks: string[] = [];
        let positive = 0, negative = 0;
        for (const [id, match] of matched) {
            const p = profile.preferences.find(p => p.id === id)!;
            score += (match.negative ? -1 : 1) * strength(p);
            if (match.negative) {
                negative++;
                risks.push(match.interpretation ? `Possible tradeoff: ${match.interpretation}` : `May conflict with your preference to ${p.direction} “${p.value}”: the catalog mentions “${match.quote.slice(0, 180)}”.`);
            }
            else
                positive++;
            evidence.push({ preferenceId: id, preference: `${p.direction} ${p.value}`, origin: p.origin, support: p.support, counterexamples: p.counterexamples, catalogQuote: match.quote, sourceUrl: `https://openlibrary.org${b.key}`, ...(match.interpretation ? { interpretation: match.interpretation } : {}) });
        }
        const literalMood = Boolean(context.mood) && (b.subjects.some(s => textMatch(s, context.mood)) || textMatch(b.description, context.mood));
        const moodFit = Boolean(ai?.mood) || literalMood;
        if (moodFit)
            score += 6; // A grounded current intent has greater weight than any single historical inference.
        const rich = Boolean(b.description) && b.subjects.length > 0;
        if (!rich)
            score -= 1;
        const knownAuthor = profile.evidence.some(e => normalize(e.author) === normalize(b.author));
        const category = positive > 0 && negative === 0 && (moodFit || !context.mood) && rich ? 'strong fit' : positive > 0 && negative > 0 ? 'wildcard' : 'discovery';
        const reason = category === 'strong fit' ? '' : category === 'wildcard' ? `A supported fit that stretches ${evidence.filter(e => matched.get(e.preferenceId)?.negative).map(e => e.preference).join(', ')}; compare the caveat before choosing.` : `${knownAuthor ? 'A work by an author in your sampled history' : 'A work outside your sampled author history'} selected for exploration${positive ? ' with some preference overlap' : '; personal fit is not established'}.`;
        const positiveEvidence = evidence.filter(e => !matched.get(e.preferenceId)?.negative).slice(0, 2);
        const fit = positiveEvidence.map(e => e.interpretation
            ? `May appeal to you: ${e.interpretation}`
            : `Your interest in “${profile.preferences.find(p => p.id === e.preferenceId)!.value}” connects with the catalog’s “${e.catalogQuote.slice(0, 160)}”.`).join(' ');
        const why = (fit || 'Verified catalog work; there is not enough evidence to claim this fits your taste.')
            + (moodFit ? ` For your current mood: ${ai?.mood?.interpretation || `the catalog mentions “${context.mood}”`}.` : context.mood ? ' A match to your current mood is not established.' : '');
        const isbn13 = b.isbns[0] || null;
        scored.push({ workKey: wk, editionKey: b.key, catalogKey: b.key, title: b.title, author: b.author, year: b.year, isbn13: null, language: b.language, coverUrl: b.coverUrl, sourceUrl: `https://openlibrary.org${b.key}`, sourceLabel: 'Open Library work catalog', subjects: b.subjects, category, why, caveat: risks.join(' ') || (!rich ? 'Description or subject evidence is incomplete; pacing, tone and enjoyment remain unknown.' : ''), ratings: { goodreads: { rating: null, count: null, status: 'not_retrieved', url: `https://www.goodreads.com/search?q=${encodeURIComponent(`${b.title} ${b.author}`)}`, freshness: 'Unknown' }, amazon: { rating: null, count: null, status: 'not_retrieved', url: `https://www.amazon.com/s?k=${encodeURIComponent(isbn13 || `${b.title} ${b.author}`)}&i=stripbooks`, freshness: 'Unknown' } }, description: b.description, series: b.series, batchReason: reason, score, evidence, assessmentMode: ai ? 'model interpretation with validated catalog citations' : 'literal catalog evidence', identityStatus: 'Catalog work verified; a language-specific acquisition edition is not verified' });
    }
    return scored.sort((a, b) => b.score - a.score || a.catalogKey.localeCompare(b.catalogKey));
}
export function selectBatch(ranked: RankedCandidate[], size = 9) {
    const remaining = [...ranked], selected: RankedCandidate[] = [];
    const authors = new Set<string>(), series = new Set<string>(), themes = new Map<string, number>();
    while (remaining.length && selected.length < size) {
        remaining.sort((a, b) => adjusted(b) - adjusted(a) || a.catalogKey.localeCompare(b.catalogKey));
        const candidate = remaining.shift()!;
        if (authors.has(normalize(candidate.author)) || (candidate.series && series.has(normalize(candidate.series))))
            continue;
        selected.push(candidate);
        authors.add(normalize(candidate.author));
        if (candidate.series)
            series.add(normalize(candidate.series));
        for (const s of candidate.subjects.slice(0, 5))
            themes.set(normalize(s), (themes.get(normalize(s)) || 0) + 1);
    }
    return selected;
    function adjusted(c: RankedCandidate) { return c.score - c.subjects.slice(0, 5).reduce((sum, s) => sum + (themes.get(normalize(s)) || 0) * 0.7, 0); }
}
