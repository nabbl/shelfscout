# ShelfScout recommendation system

Implemented locally; live personalization quality still requires the owner's history and configured model. BookOrbit acquisition, upstream deployments, host services and Kobo settings were not changed.

## Pipeline

1. **Evidence profile.** Up to six positive and six negative historical works are resolved to catalog descriptions/subjects by exact title and primary author; ambiguous or missing matches contribute no invented metadata. Personal ratings, those catalog records, and shelves generate tentative or supported subject preferences. Positive and negative examples and counterexamples remain attached. Rating zero/unrated and DNF are not dislikes. Companion ratings override source ratings without altering the import. Explicit preferences replace matching inferences; rejected inference IDs persist. Current mood belongs to a batch, not the lifetime profile.
2. **Optional AI interpretation.** An OpenAI-compatible chat endpoint interprets rated historical catalog evidence, permitted review excerpts and feedback reasons, with exact supporting quotations and record IDs. Without supporting text it cannot add prose/pacing/tone claims. Disliking a book does not establish which catalog subject caused dislike, so these inferences remain tentative. Sampling separates positive, negative, neutral and unrated records, with recent and older representatives, at most 48 records per model context and 1,800 characters per review. Dimensions include theme, prose, pacing, character, tone, structure, length and ambiguity. These are interpretations for owner confirmation, not calibrated psychological measurements.
3. **Discovery.** Up to 12 complementary Open Library searches combine AI strategies and deterministic preference/author/exploration queries. Up to 40 records per search are deduplicated by catalog work. A round-robin across queries feeds at most 60 eligible works into enrichment and assessment. The public catalog is contacted sequentially, at most once per second, with fixed-host URLs and bounded timeouts. Search and work metadata are cached locally for one and seven days respectively.
4. **Identity and evidence.** Work IDs are separate from editions. Work descriptions are accepted only with matching catalog key and title. Valid imported ISBN13 matches and exact normalized title/primary-author matches create auditable aliases. Conflicting ISBN matches are withheld in Settings → Identity review. Unknown aliases and catalog mistakes remain possible. The engine does not pretend a work's aggregate ISBN list identifies a preferred language edition: recommendation acquisition ISBN is deliberately null and the existing BookOrbit work request remains available.
5. **Assessment.** AI assesses chunks of 12 works using description/subject quotations tied to preference IDs, plus grounded mood evidence and tradeoffs. Zod rejects malformed output; deterministic validation rejects unknown works, preference IDs and nonexistent quotations. Literal subject/description matches remain a fallback. Exact quotation validation establishes provenance, not semantic entailment: model interpretations remain clearly labelled and need owner correction.
6. **Ranking and selection.** Explicit signals outweigh inferred signals; conflicts reduce inferred weight. Grounded current mood outweighs one historical signal. Missing descriptions lower evidence strength. Prior author exposure and repeated themes reduce selection priority. Author and known-series repetition are constrained within the batch. Scores are internal ordinal bookkeeping, never displayed as fit percentages. Strong fits require positive evidence, no evidenced tension, description evidence and supported mood if supplied; wildcards have both a supported fit and an explained tension. Everything else is an honest discovery. Categories are not quotas or positions; a sparse profile may yield only discoveries.
7. **Durability and learning.** Authenticated POST creates a SQLite job, GET only reads state. The worker records stages and results, and commits exposures atomically with completion. Heartbeats renew leases; a dead worker's job becomes reclaimable after two minutes. Reopened pages show the last successful batch while replacement work runs. Failed jobs preserve that batch and need an explicit retry. Expensive model outputs are cached seven days by prompt version, input/profile content, endpoint and model. No additional service is required.

## Controls and feedback

- **More:** excludes works exposed in the past 90 days and advances catalog pagination periodically. It may return fewer than nine or no books when the available pool is exhausted.
- **Refresh:** re-evaluates with current profile/mood; permits reconsideration of the last successful batch, while older exposures remain excluded. Cached catalog metadata may be reused. It does not mean a forced cache purge.
- **Already read:** excluded by default; explicit reread mode can admit it.
- **Not interested:** excludes the work until undone. Optional reasons can inform AI interpretation; disliking one book does not automatically mean disliking every catalog subject.
- **Not now:** hides the work for 30 days; no negative genre inference is created.
- **Saved:** available under Settings → Saved books and feedback; removed from discovery until undone. Saving is not a positive rating.
- **Requested:** active acquisitions and request feedback are suppressed from discovery, without becoming positive taste evidence. Existing BookOrbit acquisition remains the side-effect boundary.
- **Rating:** a separate companion override, editable from History and feedback. Clearing an override restores the imported rating. Explicit ratings inform the next profile; imported ratings/reviews remain intact.
- **Undo:** retains an audit record, removes that event's active effect. Other active actions for the same work still apply. Refresh is required to regenerate an older batch's selection.

## Exact local configuration

Use Node.js 22.13 or newer. Copy `.env.example` to `.env`, then set:

```dotenv
DEMO_MODE=false
DATA_DIR=./data
SHELFSCOUT_DB=./data/shelfscout.sqlite
OWNER_PASSWORD_HASH='<bcrypt hash; single quotes preserve dollar signs>'
SESSION_SECRET=<at least 32 random characters>
MODEL_BASE_URL=https://api.openai.com/v1
MODEL_NAME=<model supporting chat completions JSON output>
MODEL_API_KEY=<your provider API key>
```

For a local compatible server, use for example `MODEL_BASE_URL=http://127.0.0.1:1234/v1`, its loaded `MODEL_NAME`, and leave `MODEL_API_KEY` empty if that server needs no authentication. Base URL and model name enable AI; a Codex subscription does not provide an API key. Credentials stay in the server/worker environment. The web app and worker must use the same database and configuration. `.env` is loaded by both commands; environment variables take precedence for the worker.

```bash
npm ci
npm run db:migrate
npm run dev
# Separate terminal, same project:
npm run worker
```

Set BookOrbit/Shelfmark values as before when using those integrations. For production use the persistent `/data` paths configured by Compose. In Settings, import the Goodreads CSV and add/correct preferences; then choose More picks. Review sharing is OFF by default and controlled by the saved Settings checkbox, not the retired `MODEL_INCLUDE_PRIVATE_REVIEWS` variable. With AI enabled, titles, ratings, shelves, feedback reasons and bounded catalog metadata are transmitted; review text is included only with consent. No provider privacy/retention guarantee is implied by this app.

Demo mode requires `DEMO_MODE=true`, including during development. Demo pages do not call live APIs. Both development and production authentication require a configured session secret; there is no predictable development signing key.

## Evaluation and limitations

`npm run evaluate` reproduces [synthetic.json](evaluation/synthetic.json) against the frozen previous ranker. It deliberately uses one identical synthetic pool to isolate ranking behavior. These counts do not measure retrieval recall, live AI quality or future enjoyment.

`npm run evaluate:heldout -- /private/history.csv /private/independent-catalog.json` supports a temporal held-out diagnostic. The latest 20% of rated read works are held out before building the profile; matching alternate ISBN editions are also withheld from training. The catalog input must be collected independently of held-out records and have `CatalogBook[]` shape from `src/lib/recommendation/types.ts`. No held-out rating/review/shelf enters profiling, ranking or discovery; ratings are consulted only after ranking. Results go to ignored `outputs/heldout-evaluation.json`. The operator must audit catalog provenance. Real-history evaluation was not run because no export was provided.

Remaining quality limits: catalog subjects/descriptions and series data can be incomplete; only Open Library is implemented for discovery; undiscovered aliases can evade exclusion; quotation checks cannot prove model semantics; no live model was available; weights are inspectable design choices, not learned/calibrated predictions. Author/theme diversification and 90-day novelty do not guarantee diversity of prose when that metadata is unknown. Goodreads/Amazon ratings remain honestly unavailable through this discovery pipeline, with source links preserved. BookOrbit/provider integration expansion was outside this task.

SQLite export includes taste settings, batches, exposures, aliases, identity conflicts, feedback undo and companion ratings. Local cache and batches can contain consented private excerpts; include them in private backups and deletion policies. Stop web and worker before copying the data directory. No telemetry or autonomous acquisitions were added.
