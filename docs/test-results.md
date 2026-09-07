# Verification results

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
