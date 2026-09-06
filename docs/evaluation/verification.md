# Recommendation rebuild verification — 2026-09-07

## Completed checks

| Check | Actual result | Artifact |
|---|---|---|
| `npm run test` | 22 tests passed across 8 files | [unit-tests.txt](unit-tests.txt) |
| `npm run lint` | Passed, no lint findings | [lint.txt](lint.txt) |
| `npm run typecheck` | Passed | [typecheck.txt](typecheck.txt) |
| `npm run test:browser:live` | 4 authenticated desktop/mobile tests passed | [browser-live.txt](browser-live.txt) |
| `npm run test:browser` | 4 explicit-demo desktop/mobile tests passed | [browser-demo.txt](browser-demo.txt) |
| `npm run build` | Production build passed, all routes generated | [build.txt](build.txt) |
| `npm run evaluate` | Frozen baseline versus synthetic controlled reader | [synthetic.json](synthetic.json) |
| `git diff --check` | Passed | No whitespace errors |

Authenticated browser coverage uses an isolated temporary SQLite database, synthetic catalog cache, real owner login, real web APIs and the actual worker process. It covers queueing, reload, details and catalog evidence, explicit preferences, saving, undo and non-overlapping subsequent batches. It does not call a live model or BookOrbit. The initial fixture omitted a newly added preference query; that was corrected so final browser coverage uses cached synthetic data throughout. Screenshots: [desktop](browser-desktop.png), [mobile](browser-mobile.png).

Unit/integration coverage includes positive AND negative preference response, grounded mood priority, evidence-based wildcard selection, exact citation validation, malformed model output, cached model responses, local providers without API keys, unknown metadata, sparse/conflicting history, historical catalog enrichment without review sharing, ISBN alias ambiguity, work exclusion/rereads, feedback distinctions/expiry/undo, immediate saved-book filtering, SQLite reopen/recovery with live-lease protection, and retained last successful batches after catalog failure. Existing CSV/acquisition/security tests continue passing. Anonymous reads, CSRF-protected writes, and development session signing are tested.

## Baseline diagnostic

Thirty synthetic catalog works and fifteen authors; same pool for both rankers. Reader prefers memory and avoids war. These are controlled mechanics, not calibrated recommendations.

| Diagnostic | Previous baseline | New engine |
|---|---:|---:|
| Positive theme among top three | 1 | 3 |
| Repeated works in next batch | 9 | 0 |
| Distinct authors in nine picks | 9 | 9 |
| Adventure mood among top three | 2 | 3 |
| Verified alias excluded | No | Yes |
| Unsupported links to arbitrary favorite | 9 | 0 |

Changing the explicit preference to war moves three war books into the new top three. No acceptance thresholds were selected to make tests pass; raw counts and batch titles are saved. This does not establish discovery recall, semantic AI quality, or future enjoyment.

## Live source smoke test

The actual `searchCatalog` adapter resolved 40 Open Library work records for `subject:memory`. The actual `enrichBook` adapter retrieved `/works/OL15683431W`, *Moonwalking with Einstein*, with 855 description characters and 15 subjects. This used an in-memory database and no personal data or model. The [Open Library search documentation](https://openlibrary.org/dev/docs/api/search) was also inspected; work and edition identities remain separate.

## Unverified / blocked

- No owner Goodreads export was supplied: real held-out evaluation was not run. The opt-in harness is available as `npm run evaluate:heldout`; instructions and leakage boundaries are in [recommendation-system.md](../recommendation-system.md).
- No configured model access was supplied: successful live AI interpretation/planning/assessment and owner enjoyment remain unverified. Mock/schema checks must not be reported as live AI quality.
- Docker CLI exists, but `docker info` failed because the local OrbStack Docker socket is absent. Container build/runtime checks were not possible; no daemon or host service was started.
- BookOrbit, Shelfmark, Kobo, Goodreads and Amazon live integration behavior was not revalidated in this task. No acquisition or upstream change was performed. Missing community ratings remain unknown.
