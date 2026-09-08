# Verification results

## 2026-09-08 — Series acquisition and compatible release selection

- `npm test`: 185 passed in 19 files. New coverage includes live-shaped structured series records, explicit subject/title labels, malformed legacy values, direct-work fallback, transient retries, rate limits, partial lists, stale-list retention, current read/ownership/request markers, atomic multi-book recording/rollback, idempotent repeats, and original release selection indexes after filtering/capping.
- Full `npm run test:browser:live`: 42 passed across desktop/mobile. The ten series acquisition checks also passed after switching the series-label action to a dedicated accessible dialog. These exercise book-five → book-one identity, default unread selection, select-all/clear, known owned/requested exclusions, shared language/collection selection, single bulk submission, partial lists, lookup retry, cancellation, CSRF, whole-payload validation and duplicate reuse. Mobile series and confirmation screenshots were inspected.
- Lint, typecheck, production build and diff checks passed. Authenticated browser tests now use `.next-browser` alongside the user's development server and skip local dotenv processing for their fully supplied fixture environment. This fixes local dotenv expansion corrupting the fixture bcrypt hash.
- Read-only live Open Library check: `/works/OL2577486W` resolved to The Witcher and returned eight catalog entries, including two prequels and an unknown-position entry. The scan completed, but coverage is still labelled potentially incomplete.
- The idle local worker was restarted to load corrected series handling. No new live acquisition or recommendation batch was submitted, and no deployment was performed.

## 2026-09-07 — Series starting points and suggested moods

- `npm test`: 127 passed in 18 files. New cases cover structured series fields, first-book substitution and its own evidence, deduplication, missing/conflicting order, prequels, pagination, series-disabled filtering, read/saved/dismissed exclusions, history-supported moods, negative preferences, hidden choices, stale supporting evidence and settings defaults.
- Full `npm run test:browser:live`: 32 passed on desktop/mobile. Full demo browser suite: four passed. Includes series settings persistence, ordered members/read markers, coherent mood selection and clearing, durable hide/restore, 44px mobile removal targets, and owner/CSRF checks. Fixed optimistic checkbox state with rollback on save errors during these checks.
- Typecheck, lint, production build and diff checks passed. Mobile mood and series screenshots were inspected in the isolated browser fixture.
- Read-only live Open Library verification: Dune Messiah resolved as Dune #2 and was replaced with Dune #1 before ranking. The structured series list returned six numbered works. The authenticated local series endpoint returned the same list; the taste endpoint returned configured mood suggestions.
- Restarted the idle local worker to load the new rules. The user's web server was not restarted. No live recommendation generation, acquisitions or deployments were triggered. Existing recommendation cards require Refresh picks to gain newly fetched series metadata; known saved-batch series are filtered immediately.
- Catalog coverage remains incomplete: unknown series membership cannot prove standalone status, and series lists explicitly report that limitation. Series identity/order is not inferred from model output or publication year.

## 2026-09-07 — Browser expectation after boilerplate removal

The discovery test still required “Why this batch” for every book, although strong-fit fixture books intentionally omit that generic explanation. Updated the test to verify the actual fit and catalog description and absence of an empty batch section. The display regression now verifies both hidden legacy boilerplate and visible meaningful batch explanations.

- Full `npm run test:browser:live`: 26 passed, including the reported mobile discovery/worker/feedback/undo test.
- Full `npm run test:browser`: 4 passed.
- Typecheck, lint and diff checks passed. Tests ran in an isolated source copy and fixture database; no user services were restarted. No application behavior changed.

## 2026-09-07 — Shelfmark release identity compatibility

- Reproduced two false negatives from the saved Nightfall results: surname-first co-author strings and Shelfmark's preserved `📕 book (fiction)` category were rejected by literal comparisons.
- Added author-credit normalization consistently across release selection and subsequent metadata verification. Additional credits remain explicit choices, and title/language/ISBN/EPUB/pack checks still apply. Rejection reasons now identify the conflicting field.
- `npm test`: 111 passed, including eleven identity regression cases and a mocked lifecycle from manual co-author release selection through import verification. Typecheck, lint and diff checks passed.
- Reassessed the existing Nightfall results: eight releases are selectable; the reported 2010 EPUB is selectable but requires confirmation. Restarted the idle local worker and queued a search recheck for Nightfall. No release was selected or download submitted by the assistant.

## 2026-09-07 — Get book request panel

- Fixed hidden acquisition feedback: Get book now opens an accessible modal from cards and details, loads Kobo collections without requiring a Settings test, permits explicit language selection when catalog language is unknown, and opens Activity after recording the request. Loading/error states persist independently of recommendation polling. Concurrent submits are blocked; uncertain responses offer Activity without automatic replay.
- Six new desktop/mobile browser checks passed with mocked integration/submission responses: direct collection selection, pending state, navigation after submission, missing language, connection retry, persistent validation errors and lost-response handling. Four existing Activity and owner/CSRF checks also passed. No live acquisition was submitted.
- Lint, typecheck and isolated production build passed. The mobile request-panel screenshot was visually inspected. The user's dev server was not restarted.

## 2026-09-07 — BookOrbit automatic login and renewal

- `npm test`: 99 passed in 15 files. Fourteen auth cases cover concurrent login/renewal, simulated access expiry, rotating refresh cookies, expired refresh sessions, lost refresh responses, bounded HTTP 401 retries, no mutation replay on other failures, login cooldowns, manual-token compatibility and password files. An additional worker environment regression checks `.env.local`, escaped dollar signs and runtime credentials without environment files.
- Lint, typecheck and an isolated production build passed. The existing npm 10 lockfile repair is preserved; the new direct `@next/env` dependency uses the already locked Next.js version.
- Twelve isolated desktop/mobile browser checks passed for Settings, Goodreads import, ratings display/refresh and owner/CSRF boundaries. Upstream responses were mocked.
- The worker now loads environment files like Next.js; its loader is included in the runtime image. The existing local worker was restarted while idle; the user's web server was left running.
- Live password login/refresh has not been verified: no BookOrbit username/password has been configured locally yet. The earlier live ratings results below used a manual access token. No acquisition, library mutation or deployment was performed.

## 2026-09-07 — Live BookOrbit rating lookup

- `npm test`: 84 passed. Coverage includes fragmented SSE parsing, response limits, title/author/ISBN matching, source URL validation, both providers, cache reuse, preservation of old ratings after failures, disabled providers, authentication errors and deduplicated jobs.
- Recommendation display browser checks: four passed on desktop/mobile, including queueing Refresh ratings and displaying polled provider values/source links. Two additional owner/CSRF checks passed.
- Lint, typecheck and production build passed, including `/api/recommendations/ratings`.
- Live verification with the owner's renewed BookOrbit access token: both providers enabled; a Piranesi lookup returned Goodreads 4.20 / 573,387 ratings and Amazon 4.40 / 48,034 ratings. The current nine-book batch completed its separate ratings job with six matched Goodreads and six matched Amazon ratings; each provider had three unmatched/missing ratings. No acquisition or library metadata mutation was performed.
- The tested BookOrbit access token has a fifteen-minute lifetime. Cached ratings persist after token expiry. This manual-token check preceded the automatic renewal implementation recorded above.

## 2026-09-07 — Recommendation copy and rating display

- `npm test`: 77 passed. New checks cover book-specific model explanations, retained evidenced tradeoffs, imported Goodreads averages on existing batches, resolved aliases, ambiguous identity withholding and unavailable zero averages.
- `npm run test:browser:live -- tests/browser-live/recommendation-display.spec.ts`: two passed, desktop and mobile, using an isolated fixture. Confirmed numeric CSV ratings, provenance, Amazon review links, removal of saved boilerplate and retention of specific caveats.
- Lint, typecheck and production build passed. No live rating provider was added; Goodreads numbers come only from matched CSV snapshots and Amazon remains unavailable without a provider.

## 2026-09-07 — Settings import and connection feedback

- `npm test`: 72 passed, including cookie-free Shelfmark access and sanitized connection diagnostics.
- `npm run test:browser:live -- tests/browser-live/settings.spec.ts`: six passed across desktop and mobile in an isolated source copy/database. Verified delayed CSRF retrieval followed by real CSV preview/commit into fixture History, persistent connection feedback during recommendation polling, and retryable JSON/HTML/network failures. Upstream connections were mocked.
- `npm run lint`, `npm run typecheck`, `npm run build`, and `git diff --check`: passed.
- Local development server health endpoint: HTTP 200 with database status `ok`; a separate local worker was started.

The Goodreads handler now captures FormData before yielding. Connection tests report progress/results in Settings rather than writing to Discover's polling-controlled notice. Shelfmark still omits the Cookie header when unconfigured and verifies the activity response shape. BookOrbit diagnostics identify HTTP endpoint failures and common network errors without exposing upstream bodies or credentials. The production BookOrbit 502 cause remains unverified pending its response body/configuration; no live integration credentials were available in this checkout.

## 2026-09-06 — Initial verification

Run locally on 2026-09-06 with Node.js 25.2.1 and npm 11.6.2.

- `npm test`: passed — 5 files, 7 tests.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run build`: passed with Next.js 16.3.4; 1 page and 15 API routes built.
- `npm run test:browser`: passed — 4 Chromium flows across desktop and Pixel 7 profiles.
- Production-mode smoke test: `/api/health` returned `status: ok`; mobile UI rendered three explicitly labelled demo cards and the bottom navigation; CSP, no-sniff and private/no-store headers were present.
- `npm audit --audit-level=high`: passed with zero findings after updating the lockfile.

Container execution was not possible: both installed container clients were present, but neither the Docker (OrbStack) daemon nor the Podman machine was running. The production Dockerfile and Compose health check were therefore built only as source artifacts, not claimed as exercised containers.

No BookOrbit URL/JWT, Shelfmark session, Goodreads export, or ratings-provider account was available. Upstream schemas were verified against source and exercised with isolated HTTP mocks; no live request, collection mutation, or download was performed.

## 2026-09-07 — Shelfmark acquisition workflow

Latest implementation validation (separate from earlier recommendation evaluation):

- `npm test`: **62 passed**, 10 files. Includes 33 acquisition lifecycle cases, seven filesystem-evidence checks and an old-schema migration/recovery case; existing recommendation/history/auth tests pass.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed on Next.js 16.3.4.
- `npm run test:browser:live -- tests/browser-live/acquisition.spec.ts`: **4 passed** (desktop/mobile picker and recheck UI; owner authentication and CSRF). Despite the existing script name, this suite uses an isolated synthetic database and browser-mocked acquisition responses, **not live integrations**. Picker screenshots were inspected from the ignored `test-results/` directory. An initial mobile selector targeted hidden desktop navigation; the test now selects the appropriate named navigation explicitly.
- `docker compose -f compose.yml config --quiet` and `docker compose -f deploy/compose.arcane.yml config --quiet`: passed. Configuration checks only; no containers started or services restarted.
- `git diff --check`: passed.

Covered boundaries include concurrent clicks, distinct languages/editions, durable pre-submit markers, lost download/import/collection responses, file-backed database reopen, lease recovery, missing legacy jobs, complete versus partial delivery, dismissed activity history, unrelated/duplicate/pre-existing Dock entries, changed bytes, metadata/size mismatch, finalization preview conflicts, failed imports, checksum verification, collection pagination, and Kobo eligibility/read-back failures. The EPUB fixture contains original synthetic test text.

Still untested: installed upstream versions, live sessions and permissions, real source policy/search results, physical host-folder mapping, Book Dock watcher behavior and actual import/Kobo synchronization. No real books were acquired; no Kobo settings were changed; nothing was deployed or pushed. See [integration setup and recovery](integrations.md) for configuration and limitations.

## 2026-09-07 — Node 22 / npm 10 clean-install correction

Reproduced the old lockfile's failure using Node 22.23.2 and npm 10.9.9 in a fresh temporary directory: `npm ci` exited 1 with `EUSAGE`, missing `@emnapi/runtime@1.11.3` and `@emnapi/core@1.11.3`. npm 10 regenerated the lockfile with those transitive entries and normalized dependency flags; all previously locked package versions were retained.

Using the repaired lockfile in another clean, isolated source checkout on macOS:

- Actual `npm ci --foreground-scripts --no-audit --no-fund` under Node 22.23.2 / npm 10.9.9: passed, including better-sqlite3, esbuild and resolver install scripts.
- `npm test`: 62 passed.
- `npm run lint`, `npm run build`, `npm run typecheck`: passed.
- npm 10 dry-run dependency checks with Linux x64 and ARM64 platform options: passed; these are dependency-plan checks, not Linux execution.
- Existing locked dependency versions: unchanged.

The local Docker daemon was unavailable, so no Linux container build or Arcane deployment was executed. The user-provided Arcane log omitted npm's underlying output; the npm 10 lockfile failure is independently reproduced, not inferred from a captured remote npm error.
