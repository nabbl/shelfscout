import { fitCategory, isBroadGenre } from './fit';
import { preferredBookLanguage } from '../languages';
import { primarySeries } from './series';
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
        field?: 'author' | 'subjects' | 'description';
        kind?: 'match' | 'risk';
        preferenceId: string;
        preference: string;
        origin: string;
        support: string[];
        counterexamples: string[];
        catalogQuote: string;
        sourceUrl: string;
        interpretation?: string;
    }[];
    moodMatched?: boolean;
    assessmentMode: string;
    identityStatus: string;
};
export function textMatch(text: string, value: string) { const hay = ` ${normalize(text)} `; const words = normalize(value).split(' ').filter(Boolean); return words.length > 0 && words.every(w => hay.includes(` ${w} `)); }
function strength(p: Preference) { return p.origin === 'explicit' ? 4 : p.confidence === 'conflicting' ? 0.5 : p.confidence === 'supported' ? 2 : 1; }
export function rankPool(books: CatalogBook[], profile: Profile, context: RankContext, assessments: Assessment[] = []): RankedCandidate[] {
    const scored: RankedCandidate[] = [];
    for (const b of books) {
        const language = preferredBookLanguage(b, profile.settings.languages);
        if (!language) continue;
        if (!profile.settings.allowSeries && primarySeries(b)) continue;
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
            field: 'author' | 'subjects' | 'description';
        }>();
        for (const p of profile.preferences) {
            const quote = (p.dimension === 'author' && textMatch(b.author, p.value) ? b.author : '') || b.subjects.find(s => textMatch(s, p.value)) || (textMatch(b.description, p.value) ? b.description : '');
            if (quote)
                matched.set(p.id, { quote, negative: p.direction === 'avoid', field: p.dimension === 'author' && quote === b.author ? 'author' : b.subjects.includes(quote) ? 'subjects' : 'description' });
        }
        if (ai)
            for (const [links, negative] of [[ai.matches, false], [ai.risks, true]] as const)
                for (const link of links) {
                    const p = profile.preferences.find(p => p.id === link.preferenceId);
                    if (p)
                        matched.set(p.id, { quote: link.quote, interpretation: link.interpretation, negative: negative || p.direction === 'avoid', field: link.field });
                }
        let score = -Math.min(3, context.authorExposure?.get(normalize(b.author))||0);
        const evidence: RankedCandidate['evidence'] = [];
        const risks: string[] = [];
        let positive = 0;
        let genreScore = 0;
        const specificDimensions = new Set<string>();
        for (const [id, match] of matched) {
            const p = profile.preferences.find(p => p.id === id)!;
            // Several overlapping genre tags are one broad signal, not several strong matches.
            if (!match.negative && isBroadGenre(p.value)) genreScore += Math.min(1, strength(p));
            else score += (match.negative ? -1 : 1) * strength(p);
            if (!match.negative && match.interpretation && match.field === 'description' && !isBroadGenre(p.value) && !['author', 'subject'].includes(p.dimension)) specificDimensions.add(p.dimension);
            if (match.negative) {
                risks.push(match.interpretation ? `Possible tradeoff: ${match.interpretation}` : `May conflict with your preference to ${p.direction} “${p.value}”: the catalog mentions “${match.quote.slice(0, 180)}”.`);
            }
            else
                positive++;
            evidence.push({ field: match.field, kind: match.negative ? 'risk' : 'match', preferenceId: id, preference: `${p.direction} ${p.value}`, origin: p.origin, support: p.support, counterexamples: p.counterexamples, catalogQuote: match.quote, sourceUrl: `https://openlibrary.org${b.key}`, ...(match.interpretation ? { interpretation: match.interpretation } : {}) });
        }
        score += Math.min(2, genreScore) + Math.min(4, specificDimensions.size * 2);
        const literalMood = Boolean(context.mood) && (b.subjects.some(s => textMatch(s, context.mood)) || textMatch(b.description, context.mood));
        const moodFit = Boolean(ai?.mood) || literalMood;
        if (moodFit)
            score += 6; // A grounded current intent has greater weight than any single historical inference.
        const rich = Boolean(b.description) && b.subjects.length > 0;
        if (!rich)
            score -= 1;
        const knownAuthor = profile.evidence.some(e => normalize(e.author) === normalize(b.author));
        const { category, categoryReason } = fitCategory({ ...b, evidence, moodMatched: moodFit }, profile, context.mood);
        const reason = ['strong fit', 'matches your interests'].includes(category) ? '' : category === 'wildcard' ? `A supported fit that stretches ${evidence.filter(e => matched.get(e.preferenceId)?.negative).map(e => e.preference).join(', ')}; compare the caveat before choosing.` : `${knownAuthor ? 'A work by an author in your sampled history' : 'A work outside your sampled author history'} selected for exploration${positive ? ' with some preference overlap' : '; personal fit is not established'}.`;
        const priority = (e: RankedCandidate['evidence'][number]) => (e.interpretation ? 4 : 0) + (e.field === 'description' ? 2 : 0) + (isBroadGenre(profile.preferences.find(p => p.id === e.preferenceId)!.value) ? 0 : 1);
        const positiveEvidence = evidence.filter(e => e.kind === 'match').sort((a, b) => priority(b) - priority(a));
        const interpretations = [...new Set(positiveEvidence.map(e => e.interpretation?.trim()).filter((text): text is string => Boolean(text)))].slice(0, 2);
        const specificEvidence = positiveEvidence.filter(e => !isBroadGenre(profile.preferences.find(p => p.id === e.preferenceId)!.value)).slice(0, 2);
        const fit = ai?.explanation?.text || interpretations.join(' ') || specificEvidence.map(e => `Your interest in “${profile.preferences.find(p => p.id === e.preferenceId)!.value}” connects with the catalog’s “${e.catalogQuote.slice(0, 160)}”.`).join(' ')
            || (positiveEvidence.length ? 'This overlaps with your preferred genres, but a more personal match is not established by the available evidence.' : '');
        const why = (fit || 'Verified catalog work; there is not enough evidence to claim this fits your taste.')
            + (moodFit ? ` For your current mood: ${ai?.mood?.interpretation || `the catalog mentions “${context.mood}”`}.` : context.mood ? ' A match to your current mood is not established.' : '');
        const isbn13 = b.isbns[0] || null;
        scored.push({ workKey: wk, editionKey: b.key, catalogKey: b.key, title: b.title, author: b.author, year: b.year, isbn13: null, language, languages: b.languages || [b.language], coverUrl: b.coverUrl, sourceUrl: `https://openlibrary.org${b.key}`, sourceLabel: 'Open Library work catalog', subjects: b.subjects, category, categoryReason, moodMatched: moodFit, why, caveat: risks.join(' ') || (!rich ? 'Description or subject evidence is incomplete; pacing, tone and enjoyment remain unknown.' : ''), ratings: { goodreads: { rating: null, count: null, status: 'not_retrieved', url: `https://www.goodreads.com/search?q=${encodeURIComponent(`${b.title} ${b.author}`)}`, freshness: 'Unknown' }, amazon: { rating: null, count: null, status: 'not_retrieved', url: `https://www.amazon.com/s?k=${encodeURIComponent(isbn13 || `${b.title} ${b.author}`)}&i=stripbooks`, freshness: 'Unknown' } }, description: b.description, series: b.series, seriesMemberships: b.seriesMemberships, batchReason: reason, score, evidence, assessmentMode: ai ? 'model interpretation with validated catalog citations' : 'literal catalog evidence', identityStatus: 'Catalog work verified; a language-specific acquisition edition is not verified' });
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
