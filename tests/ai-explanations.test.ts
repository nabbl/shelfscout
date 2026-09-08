import { afterEach, expect, it, vi } from 'vitest';
import { createDatabase } from '../src/lib/db';
import { assessCandidates, catalogEvidence, decodeAssessments, modelFailureReason, parseAssessments, validateAssessments } from '../src/lib/recommendation/ai';
import { rankPool, type RankContext } from '../src/lib/recommendation/rank';
import type { Assessment, CatalogBook, Preference, Profile } from '../src/lib/recommendation/types';

const preference = (value: string, dimension: Preference['dimension'] = 'theme'): Preference => ({ id: value, value, dimension, direction: 'prefer', origin: 'explicit', confidence: 'supported', support: ['owner'], counterexamples: [] });
const preferences = [preference('fantasy'), preference('science fiction'), preference('moral dilemmas', 'character')];
const profile: Profile = { version: 'test', preferences, evidence: [], unknown: [], settings: { preferences, languages: ['en'], disabled: [], hiddenMoods: [], includeReviews: false, rereads: false, allowSeries: true } };
const context: RankContext = { known: new Set(), dismissed: new Set(), deferred: new Set(), saved: new Set(), requested: new Set(), exposed: new Set(), aliases: new Map(), mood: '', rereads: false };
const book: CatalogBook = { key: '/works/OL1W', title: 'A Divided City', author: 'A Writer', year: 2020, language: 'eng', isbns: [], coverUrl: null, subjects: ['Fantasy fiction', 'Science fiction, fantasy, horror'], description: 'A healer must choose between saving her city and protecting the exiled people it fears.', series: null, strategies: ['test'] };
const assessment: Assessment = {
  key: book.key,
  matches: [{ preferenceId: 'moral dilemmas', field: 'description', quote: 'choose between saving her city and protecting the exiled people', interpretation: 'The healer’s choice puts loyalty and compassion in conflict, which could suit your interest in moral dilemmas.' }],
  risks: [], mood: null,
  explanation: { text: 'A healer torn between saving her city and protecting its exiles puts your interest in moral dilemmas at the heart of the story.', preferenceIds: ['moral dilemmas'] },
};
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('uses a book-specific AI explanation even when genre preferences are listed first', () => {
  const valid = validateAssessments([book], profile, [assessment]);
  const result = rankPool([book], profile, context, valid)[0];
  expect(result.why).toBe(assessment.explanation!.text);
  expect(result.why).not.toContain('catalog’s');
  expect(result.evidence.find(e => e.preferenceId === 'moral dilemmas')).toMatchObject({ field: 'description', catalogQuote: assessment.matches[0].quote });
});

it('prioritizes an existing AI interpretation over early literal genre matches', () => {
  expect(rankPool([book], profile, context, [{ ...assessment, explanation: undefined }])[0].why).toBe(assessment.matches[0].interpretation);
});

it('ranks a specific semantic connection ahead of a stack of genre tags', () => {
  const narrow = { ...book, key: '/works/OL2W', subjects: ['Healers'] };
  const weak = { ...book, description: 'An anthology of fantasy fiction and science fiction.' };
  const inferredProfile = { ...profile, preferences: preferences.map(p => p.id === 'moral dilemmas' ? { ...p, origin: 'model' as const, confidence: 'tentative' as const } : p) };
  const results = rankPool([weak, narrow], inferredProfile, context, [{ ...assessment, key: narrow.key }]);
  expect(results[0].catalogKey).toBe(narrow.key);
  // A more informative match does not turn a tentative preference into a Strong fit.
  expect(results[0].category).toBe('matches your interests');
});

it.each([
  { ...assessment, matches: [] },
  { ...assessment, matches: [{ ...assessment.matches[0], quote: 'An invented plot detail' }] },
])('rejects explanations without valid positive supporting evidence', invalid => {
  expect(validateAssessments([book], profile, [invalid])).toHaveLength(0);
});

it('keeps verified assessments when another book in the same response has an invented quote', async () => {
  const db = createDatabase(':memory:');
  vi.stubEnv('MODEL_BASE_URL', 'http://model.test/v1'); vi.stubEnv('MODEL_NAME', 'fixture'); vi.stubEnv('MODEL_API_KEY', '');
  const other = { ...book, key: '/works/OL2W' };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify({ assessments: [assessment, { ...assessment, key: other.key, matches: [{ ...assessment.matches[0], quote: 'Invented plot' }] }] }) } }] })));
  try { expect(await assessCandidates(db, profile, '', [book, other])).toEqual([assessment]); }
  finally { db.close(); }
});

it('does not discard an entire group when one book fails structural validation', async () => {
  const db = createDatabase(':memory:');
  vi.stubEnv('MODEL_BASE_URL', 'http://model.test/v1'); vi.stubEnv('MODEL_NAME', 'fixture'); vi.stubEnv('MODEL_API_KEY', '');
  const books = Array.from({ length: 12 }, (_, i) => ({ ...book, key: `/works/OL${i + 1}W` }));
  const values = books.map(b => ({ ...assessment, key: b.key }));
  const malformed = { ...values[4], matches: [{ ...assessment.matches[0], field: 'invented' }] };
  const response = { assessments: values.map((value, index) => index === 4 ? malformed : value) };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify(response) } }] })));
  try {
    const valid = await assessCandidates(db, profile, '', books);
    expect(valid).toHaveLength(11);
    expect(valid.map(a => a.key)).not.toContain(books[4].key);
    expect(rankPool(books, profile, context, valid).filter(b => b.why === assessment.explanation!.text)).toHaveLength(11);
    // Cached responses follow the same record-level validation on the next run.
    expect(await assessCandidates(db, profile, '', books)).toEqual(valid);
  } finally { db.close(); }
});

it('accepts an omitted mood as no mood evidence, but never coerces invalid citations', () => {
  const withoutMood = { ...assessment, mood: undefined };
  expect(parseAssessments([withoutMood])).toEqual([assessment]);
  expect(parseAssessments([{ ...assessment, matches: [{ ...assessment.matches[0], field: 'invented' }] }])).toHaveLength(0);
});

it('keeps valid positive reasoning when an unsupported risk or summary is rejected', () => {
  const invalidRisk = { ...assessment.matches[0], quote: 'A romance subplot that is not in the description', interpretation: 'Invented risk.' };
  const validated = validateAssessments([book], profile, [{ ...assessment, risks: [invalidRisk] }]);
  expect(validated).toHaveLength(1);
  expect(validated[0]).toMatchObject({ matches: assessment.matches, risks: [], explanation: null });
  expect(rankPool([book], profile, context, validated)[0].why).toBe(assessment.matches[0].interpretation);
  const invalidSummary = { ...assessment, explanation: { text: 'An unsupported paragraph.', preferenceIds: ['unknown'] } };
  expect(validateAssessments([book], profile, [invalidSummary])[0].explanation).toBeNull();
});

it('handles the real malformed null reference list without discarding valid citations', () => {
  const parsed = parseAssessments([{ ...assessment, explanation: { text: 'This paragraph has no usable references.', preferenceIds: null } }]);
  expect(parsed[0]).toMatchObject({ matches: assessment.matches, explanation: null });
  expect(validateAssessments([book], profile, parsed)).toHaveLength(1);
});

it('retains good links when another link uses an unsupported source field', () => {
  const parsed = parseAssessments([{ ...assessment, risks: [{ ...assessment.matches[0], field: 'title' }] }]);
  expect(parsed[0]).toMatchObject({ matches: assessment.matches, risks: [], explanation: null });
  expect(validateAssessments([book], profile, parsed)).toHaveLength(1);
});

it('never accepts an avoid preference as a positive match or justification', () => {
  const avoid = { ...preference('romantasy'), direction: 'avoid' as const };
  const p = { ...profile, preferences: [...preferences, avoid] };
  const valid = validateAssessments([book], p, [{ ...assessment, matches: [...assessment.matches, { ...assessment.matches[0], preferenceId: 'romantasy' }], explanation: { text: 'Unfounded assurance of no romantasy.', preferenceIds: ['romantasy'] } }]);
  expect(valid[0].matches.map(link => link.preferenceId)).toEqual(['moral dilemmas']);
  expect(valid[0].explanation).toBeNull();
});

it('resolves numbered references into exact catalog quotes and real preference IDs', () => {
  const wire = { key: book.key, matches: [{ preferenceId: 'P3', evidenceId: 'D1', interpretation: 'The healer faces a moral dilemma.' }], risks: [], mood: null, explanation: { text: 'The healer’s difficult choice could appeal to your interest in moral dilemmas.', preferenceIds: ['P3'] } };
  const valid = validateAssessments([book], profile, parseAssessments(decodeAssessments([wire], [book], profile)));
  expect(valid[0].matches[0]).toMatchObject({ preferenceId: 'moral dilemmas', quote: book.description, field: 'description' });
  expect(valid[0].explanation?.preferenceIds).toEqual(['moral dilemmas']);
  const forged = { ...wire, matches: [{ ...wire.matches[0], evidenceId: 'D999' }] };
  expect(validateAssessments([book], profile, parseAssessments(decodeAssessments([forged], [book], profile)))).toHaveLength(0);
});

it('keeps all numbered description excerpts exact and excludes ambiguous novel labels', () => {
  const long = { ...book, description: book.description.repeat(20), subjects: ['Romans', 'Fantasy fiction'] };
  const excerpts = catalogEvidence(long);
  expect(excerpts.filter(e => e.field === 'description').length).toBeGreaterThan(1);
  expect(excerpts.every(e => e.text.length <= 450 && (e.field === 'description' ? long.description.includes(e.text) : long.subjects.includes(e.text)))).toBe(true);
  expect(excerpts.some(e => e.text === 'Romans')).toBe(false);
});

it('keeps tradeoffs and mood limitations alongside the AI paragraph', () => {
  const p = { ...profile, preferences: [...preferences, { ...preference('exile'), direction: 'avoid' as const }] };
  const a = { ...assessment, risks: [{ preferenceId: 'exile', field: 'description' as const, quote: 'exiled people', interpretation: 'The exile theme may be a difficult fit.' }] };
  const result = rankPool([book], p, { ...context, mood: 'lighthearted' }, validateAssessments([book], p, [a]))[0];
  expect(result.category).toBe('wildcard');
  expect(result.caveat).toContain('exile theme');
  expect(result.why).toContain('A match to your current mood is not established.');
});

it('keeps genre-only and absent-evidence fallbacks honest without repeating tag sentences', () => {
  const result = rankPool([book], profile, context)[0];
  expect(result.why).toContain('preferred genres');
  expect(result.why).not.toContain('connects with the catalog');
  expect(rankPool([{ ...book, subjects: [], description: '' }], profile, context)[0].why).toContain('not enough evidence');
});

it('reports AI failures without including credentials or model response text', () => {
  expect(modelFailureReason(new Error('Model request failed (401)'))).toContain('HTTP 401');
  expect(modelFailureReason(new SyntaxError('private response'))).toBe('the model returned invalid JSON');
  expect(modelFailureReason(new Error('token=secret'))).not.toContain('secret');
});
