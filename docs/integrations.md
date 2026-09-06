# Integration reconnaissance

Checked on 2026-09-06. This document distinguishes source verification from live execution.

## BookOrbit — acquisition owner

Source inspected: `bookorbit/bookorbit` commit `028d4287b4f727336eabd3af29d165a73c661faa` (describes as `v2.8.1-46-g028d4287`, committed 2026-09-06). No BookOrbit instance URL or credential was present, so live version, permissions, automation, sources, library availability, and response bodies remain **not exercised**.

The Nest application prefixes normal routes with `/api/v1`. Authentication extracts a JWT first from `Authorization: Bearer <JWT>`, then from the `access_token` cookie. The request controller requires `book_request_access`; `selfServe: true` additionally requires `book_request_self_fulfill`. Auto-approval depends on `book_request_auto_approve`. Configuration of indexers/download clients is a separate administrator capability and is not touched by ShelfScout.

Verified request API:

- `POST /api/v1/book-requests/availability` (read-only): body `{ "items": [{ "title": string, "author"?: string, "isbn13"?: string, "providerKey"?: string, "providerId"?: string, "mediaKind": "ebook" }] }`, maximum 50. Each result is `{ ownedBookId: number|null, existingRequestId: number|null, existingRequestStatus: string|null, alreadySubscribed: boolean }`.
- `POST /api/v1/book-requests`: required `{ title, mediaKind }`; ShelfScout sends `authors`, `isbn13`, `language`, Open Library identity, cover, year, and `preferredFormats: ["epub"]`. `selfServe` is deliberately omitted. Result contains `{ request, created, attached }`; BookOrbit itself deduplicates concurrent requests.
- `GET /api/v1/book-requests`, `GET /api/v1/book-requests/:id`, and `GET /api/v1/book-requests/summary` provide reconciliation/status.
- `BookRequestItem` includes request identity, `status`, bibliographic fields, `matchedBookId`, `bookDockFileId`, status/failure details, and a download object with byte progress, status, errors, and grabbed/completed/imported timestamps.

Verified collection API: `GET /api/v1/collections`; `POST /api/v1/collections/:id/books` with `{ "bookIds": [number] }`; and `GET /api/v1/collections/:id/books?page=0&size=100` for membership read-back. ShelfScout only offers existing `syncToKobo: true` collections and never changes Kobo configuration. Without a target collection it stops at **Needs attention**. Device arrival remains outside the API boundary; the terminal app state is **Ready for Kobo**.

The inspected metadata source stores ratings and Amazon/Goodreads IDs for owned/imported books, but no verified pre-acquisition ratings contract was found. ShelfScout does not create fake library books for metadata.

## Shelfmark — optional, not an acquisition owner

Source inspected: `calibrain/shelfmark` commit `46d21cafbcdd8369cb676fbe48a0743e911b5819` (2026-09-05). Source exposes `GET /api/health`, authenticated metadata/search/release/download/status routes, and its own `/api/requests` flow. Authentication can be local session, OIDC, proxy auth, or other configured modes. Its endpoints are application endpoints rather than a promised stable public integration API.

Shelfmark’s documented purpose is search/download/delivery to a configured destination; it does not track BookOrbit ownership. A shared mount would not prove the destination or Book Dock finalization. This release therefore performs an optional health check only and never submits acquisition to Shelfmark. Existing Shelfmark use remains untouched.

## Candidate and ratings sources

Open Library `https://openlibrary.org/search.json` is the working discovery/catalog adapter. Requests are server-side, fixed to that HTTPS host, bounded, cached, and resolved to work links. Catalog subjects are facts; fit explanations are labelled inferences.

Goodreads averages imported from CSV are stored as import-time snapshots with unknown measurement time. Recommendation cards link to Goodreads reviews. Amazon cards link to marketplace search; ratings remain `unknown` because no permitted stable ratings API was verified. Neither source is scraped and outages never block history or acquisition. A compliant authenticated ratings provider remains the ratings blocker.

