# Shelfmark → BookOrbit acquisition

Source verified on 2026-09-07. Acquisition verification uses mocked HTTP APIs and an original EPUB fixture; installed versions and live acquisition remain unverified. BookOrbit bearer authentication and read-only rating lookups were subsequently exercised successfully (see `docs/test-results.md`). Development did not acquire books, change Kobo settings, restart upstream services, deploy, or push changes.

## Source contracts and authentication

Inspected snapshots:

- [Shelfmark `46d21caf`](https://github.com/calibrain/shelfmark/tree/46d21cafbcdd8369cb676fbe48a0743e911b5819): `shelfmark/main.py`, `download/orchestrator.py`, `core/activity_routes.py`, `core/download_history_service.py`, `download/outputs/folder.py`, `config/settings.py`.
- [BookOrbit `3d6afb31`](https://github.com/bookorbit/bookorbit/tree/3d6afb314957a6c52c9242c1ed3f8a35a35821e7): `server/src/modules/book-dock`, `modules/book/book.controller.ts`, `modules/book-request`, `packages/types/src/book-dock.ts` and `book.ts`.
- [Open plugins `cdff2ae7`](https://github.com/orbit-plugins/bookorbit-open-plugins/tree/cdff2ae78cb09733e70dc92d4a91ce58df7ee921). No plugin was added. BookOrbit's direct downloader rejects private/local addresses; an indexer release URL is not a Shelfmark queue result.
- Product documentation: [Book Dock](https://bookorbit.app/book-dock), [Book Requests](https://bookorbit.app/book-requests).

Shelfmark authenticates application endpoints through its configured login/session mode. `SHELFMARK_COOKIE` is an existing authenticated cookie header, typically `session=...`; renew it when it expires. It is not a Shelfmark API key. No key endpoint or automatic login protocol is assumed. Local/OIDC sessions can work; deployments requiring proxy authentication must arrange a valid authenticated session or compatible trusted proxy themselves. Omit the cookie only for a deliberately unauthenticated instance on a trusted network. The ShelfScout connection test reads authenticated activity; `/api/health` alone would not prove permission to search/download. Shelfmark's per-user source policy must allow direct **download**, not only requests. These are application APIs, not a guaranteed stable external API.

Verified Shelfmark contracts:

- `GET /api/releases?provider=manual&book_id=...&title=...&author=...&languages=en&content_type=ebook`. Manual metadata mode is supported and avoids treating ShelfScout's edition hash as an Open Library ID. Returns `{releases, errors?}`. Preserve the selected upstream release payload server-side.
- `POST /api/releases/download` receives that release (`source`, `source_id`, `title`, format and metadata). Response is `{status:"queued",priority:0}`, **without a generated job ID or completed-file URL**. Queue task ID is `source_id`.
- `GET /api/activity/snapshot` returns `{status:{[state]:{[taskId]:download}},...}`. The download includes `source`, `id`, `added_time` (epoch seconds) and an existing `download_path` when delivered. Terminal state is `complete`; error/cancelled states must not be imported.
- `GET /api/activity/history?limit=100&offset=0` provides dismissed activity. Downloads appear under `snapshot.download`, with `final_status` on the outer item. The adapter reads both surfaces and paginates history. Snapshot persistence is limited upstream (200 recent records); absent or erased evidence stops for review, never triggers another POST.

Configure `BOOKORBIT_USERNAME` and `BOOKORBIT_PASSWORD` (or `BOOKORBIT_PASSWORD_FILE`) for automatic server-side login. ShelfScout obtains an access JWT, renews it before expiry using BookOrbit’s rotating refresh cookie, and logs in again when the refresh session expires. Password login must be enabled in BookOrbit. Credentials take precedence over the optional legacy `BOOKORBIT_TOKEN`, which remains a manually renewed fallback. Web and worker keep separate sessions in memory; credentials and cookies are never returned to the browser. Required capabilities for this workflow: `book_request_access` for read-only ownership/legacy availability, `book_dock_access`, `manage_book_dock` for settings read/rescan and visibility of watched files, `library_upload` for finalization, `library_download` for imported-byte verification, access to the destination library/folder, and rights to the selected collection. ShelfScout does not grant permissions or change any Kobo settings.

Verified BookOrbit routes (all prefixed `/api/v1`):

- `POST /book-requests/availability` with `{items:[{title,author,isbn13,providerKey?,providerId?,mediaKind:"ebook"}]}` is an **ownership lookup**, not request creation. Existing request IDs are reconciled through `GET /book-requests/:id`; ShelfScout never POSTs a new BookOrbit Request.
- `GET /book-dock/settings`, `GET /book-dock/files?page=1&limit=100`, `GET /book-dock/files/:id`, `POST /book-dock/rescan` (204).
- `POST /book-dock/finalize/preview` and `POST /book-dock/finalize` receive exactly `{fileIds:[fileId],overrides:[{fileId,libraryId,folderId}]}`. Explicit overrides prevent saved per-file targets overriding the configured library. No bulk/select-all import is used.
- Preview must contain exactly the selected ID with status `ready`. Finalize returns per-file `{fileId,success,bookId}`. Dock entries are deleted on successful import, so a missing entry alone does not prove success.
- `GET /books/:id` contains identity and `files:[{id,format,sizeBytes,...}]`. `GET /books/files/:fileId/download` streams bytes for SHA-256 verification, bounded to 512 MiB. Nothing is written back to the library.
- `GET /collections`; `POST /collections/:id/books` with `{bookIds:[id]}`; paginated membership `GET /collections/:id/books?page=0&size=100`. Read before write and after write; revalidate `syncToKobo`.

Only configured upstream origins receive credentials; redirects are rejected. Upstream error bodies and release URLs are not exposed in Activity or logs. Persisted release payloads can contain signed upstream download URLs: treat the SQLite backup as private along with other application data.

## Troubleshooting connection tests

Settings shows progress and the result beside each connection button. These messages remain visible while recommendation polling runs. Shelfmark's test checks `/api/activity/snapshot`; leave `SHELFMARK_COOKIE` blank when authentication is disabled. A cookie is only required when the upstream instance requires a session.

BookOrbit's test reads `/api/v1/book-dock/summary` and `/api/v1/collections`. ShelfScout returns HTTP 502 when either upstream request fails; the JSON `error` field identifies the failed endpoint and provides guidance. An upstream 401 means the JWT is missing, invalid or expired; 403 means insufficient permissions; 404 means the base URL or installed API version needs checking. Configure the application base URL (including any deployment subpath), without `/api/v1`. DNS and connection-refused errors refer to reachability **from ShelfScout**, which can differ from reachability in your browser. Tests perform no acquisitions or collection changes.

## Shared folder configuration

All three paths below refer to **the same host directory**, for example `/srv/books/incoming`:

| Service | Host mount | Service-side configuration |
| --- | --- | --- |
| Shelfmark | `/srv/books/incoming:/books` (writable) | Books output: Folder; Destination `/books` |
| BookOrbit | `/srv/books/incoming:/book-dock` (writable) | `BOOK_DOCK_PATH=/book-dock` in BookOrbit |
| ShelfScout worker | `/srv/books/incoming:/incoming:ro` | `SHELFSCOUT_INCOMING_DIR=/incoming` (Compose fixes this) |

BookOrbit's **final library** is separate, for example `/srv/books/library:/library`. Choose that library's existing ID and folder ID as `BOOKORBIT_LIBRARY_ID` and `BOOKORBIT_FOLDER_ID`. Book Dock is an incoming staging area, not an imported library. Shelfmark's torrent/Usenet client working/partial-download directory must also be separate from incoming.

Set ShelfScout's environment:

```dotenv
BOOKORBIT_URL=http://bookorbit:3000
BOOKORBIT_USERNAME=<existing username>
BOOKORBIT_PASSWORD=<existing password>
BOOKORBIT_LIBRARY_ID=4
BOOKORBIT_FOLDER_ID=5
BOOKORBIT_DOCK_DIR=/book-dock
SHELFMARK_URL=http://shelfmark:8084
SHELFMARK_COOKIE=session=<existing session>
SHELFMARK_OUTPUT_DIR=/books
SHELFSCOUT_INCOMING_HOST_DIR=/srv/books/incoming
# Native (non-Compose) worker only: actual local view of the same directory
SHELFSCOUT_INCOMING_DIR=/srv/books/incoming
```

`BOOKORBIT_DOCK_DIR`, `SHELFMARK_OUTPUT_DIR`, `SHELFSCOUT_INCOMING_DIR` and the host mount variable are **ShelfScout mapping settings**, not invented upstream API options. The real BookOrbit setting is `BOOK_DOCK_PATH`; Shelfmark's destination is set in its UI (`DESTINATION`, with legacy environment alias `INGEST_DIR`). Service hostnames must resolve on your deployment network; use a reachable host address or attach the existing external network as appropriate.

Create and map the host directory yourself. Give Shelfmark and BookOrbit write access and the ShelfScout worker UID 1001 read/traverse access. Both Compose files mount incoming **only into the worker**, read-only. Without `SHELFSCOUT_INCOMING_HOST_DIR`, an empty named fallback volume keeps recommendation-only installs usable; it does not connect to any upstream files and acquisitions cannot complete. Never mistake it for a working shared-folder configuration.

Required setup constraints for the inspected Book Dock contract:

1. In Shelfmark, set **Folder** output and **Rename Only** or **None** file organization. Use a flat destination with single EPUB releases. No per-user subdirectories, packs or organized folders. All non-`covers` subdirectories and symlinks in incoming are rejected because Book Dock's API omits absolute paths/checksums and cannot prove which nested unit owns a filename.
2. Disable Book Dock **auto-finalization** for this watched folder so ShelfScout can verify identity first. ShelfScout reads this flag and stops before download if enabled; it never changes it. Keep automatic metadata-file rewriting/other tools from changing completed bytes during acquisition. The operator makes any setup changes; development did not.
3. Confirm BookOrbit's reported Book Dock path equals `BOOKORBIT_DOCK_DIR`, and all three mounts really reference the same host directory. Path strings in different containers do not by themselves prove this physical mapping.
4. Test both connections in Settings. Get book also loads your Kobo-enabled collections directly, without requiring a prior connection test. Choose a collection in the request panel and supply the requested language when the catalog has none. A recorded request opens Activity; connection and validation errors remain visible in the panel. Run the worker in addition to the web process.

### Download setup is incomplete

Connection tests confirm API access; downloads also require a final library target and shared filesystem access. The worker reports the exact missing settings before contacting Book Dock or submitting a download. Use positive integer `BOOKORBIT_LIBRARY_ID` and `BOOKORBIT_FOLDER_ID` values from BookOrbit's authenticated `GET /api/v1/libraries` response (`id` and the chosen member of `folders`). Read `BOOKORBIT_DOCK_DIR` from `GET /api/v1/book-dock/settings` (`bookDockPath`), and `SHELFMARK_OUTPUT_DIR` from Shelfmark's Downloads → Destination setting.

The APIs report container paths, not Docker host volume mappings. Inspect the actual mounts to identify the shared host directory. For Compose, set `SHELFSCOUT_INCOMING_HOST_DIR` to that directory; the supplied worker configuration mounts it read-only at `/incoming`. For a native worker on another machine, mount the shared directory there and set `SHELFSCOUT_INCOMING_DIR` to its local absolute path. A Tailscale service URL provides API access but does not mount files. An empty local folder cannot substitute for the shared files.

After changing environment settings, restart the native worker or recreate the Compose worker with the updated environment and mounts, then use **Recheck** on the existing acquisition. Missing configuration does not record a download attempt, so it can resume after setup is corrected.

## Lifecycle, evidence and recovery

Intent + job commit in one SQLite transaction before network work. New jobs first check ownership; an existing owned EPUB is strictly verified and added to the selected collection. If a BookOrbit Request already exists, continue following it rather than creating competing Shelfmark work. Otherwise search Shelfmark, prefer EPUB, and require exact title/author/language/ISBN evidence for automatic selection. Author matching recognizes surname-first credits and explicit co-author lists. Additional authors require manual release confirmation even when an ISBN matches; embedded/selected/library metadata uses the same author normalization. Shelfmark source categories such as `📕 book (fiction)` are accepted when the format is EPUB. Mismatches report the specific title, author, language, ISBN, format or pack constraint. Multiple compatible releases or missing edition evidence show an Activity release picker; incompatible known languages/formats/books/ISBNs cannot be selected. A missing release ISBN can be explicitly confirmed, but embedded and selected metadata must still match the requested ISBN before import. Correctly labelled releases with sparse or conflicting metadata may require review instead of automatic completion.

Persist the full chosen release, globally reserve its upstream task ID, and write a download-attempt marker **before** POST. Persist its generation timestamp, completion path, baseline Dock IDs, local file size, SHA-256 and inode/time evidence. Wait for terminal `complete`, then stable repeated file observations at least five seconds apart. Require a unique new flat Dock ID, exact file size, EPUB format, no multi-file unit, and matching embedded and effective finalization title/author/language/ISBN. The public BookOrbit finalize API uses selected metadata when present, otherwise embedded metadata; no manual selection is required for a ready file. Regional language tags such as `en-US` and `en_GB` match `en`. Fetched metadata and its confidence score do not replace the metadata this endpoint actually imports. Finalization uses only that ID after a clean preview and another read/hash check. Imported bytes and identity must match before any collection changes. Nested files, changed files, ambiguous IDs, old activity and unverifiable metadata stop at **Needs attention**.

States distinguish checking ownership, searching/selecting, submitting/uncertain submission, downloading, **awaiting import**, **importing**, **available in BookOrbit**, and **ready for Kobo sync**. Ready means verified EPUB plus collection membership, never actual device delivery.

Double clicks return the existing acquisition; another selected collection is retained as another target without another download. No UI action clears an attempted download/import marker. Jobs survive process restart, expired job leases are reclaimed, active acquisition jobs are serialized, and missing legacy jobs are restored on worker startup. The additive migration retains all old acquisition records, BookOrbit request IDs and event history; rows without the new flow table entry use legacy reconciliation. New recommendations, catalog ranking and feedback logic are unchanged.

In **Needs attention**, read the reason and event history, repair the indicated upstream/configuration issue, then use **Recheck / refresh releases** (or **Recheck / retry download** while tracking a submitted download):

- Before submission: recheck can search again or retry preparation; choose a compatible release explicitly.
- Submission timestamp: Shelfmark uses fractional seconds for active tasks and whole seconds for persisted snapshot/history entries. ShelfScout accepts that precision change within the same second while preserving the original observation. Different precise timestamps and different seconds still stop reconciliation. Requests stopped by the previous exact timestamp comparison can use Recheck after updating the worker; no download marker needs clearing. Missing timestamps and activity older than the submission now have distinct errors.
- Uncertain download: recheck snapshot/history by the reserved ID and generation. A successful HTTP response never proves completion. After 10 minutes with no evidence, inspect the exact release in Shelfmark. Resume/retry there only after reviewing upstream state. A changed generation is intentionally rejected and requires operator reconciliation; there is no unsafe “reset and redownload” button.
- Failed download: after fixing the cause, click **Recheck / retry download**. The worker re-reads the saved task, requires matching source/timestamp evidence, a failed or cancelled state and `retry_available=true`, and revalidates ownership, folder access, Book Dock settings and the Kobo collection. It records one explicit retry before `POST /api/download/:book_id/retry`; it does not resubmit `/releases/download` or clear the original submission marker. Each later failure needs another click. Active, completed, unavailable and conflicting tasks are only reconciled. Missing delivered paths require fixing delivery/mapping; the worker never chooses the newest incoming file.
- Retry recovery: retry intent survives worker restarts. Shelfmark can retain the original timestamp for an in-memory retry or assign a new active timestamp after restoration; persisted terminal entries can retain the original queue time. A successful retry response or an observed transition out of failure confirms the retry. If the response is lost and the same failure remains, ShelfScout cannot prove whether another attempt occurred: it stops after 10 minutes and further Recheck clicks do not resend the retry. Review or resume the task in Shelfmark; subsequent active/completed evidence allows reconciliation. A fresh Book Dock baseline is recorded before each retry, so old or partial Dock entries may still require manual review.
- Failed/uncertain import: the persisted Dock ID remains reserved. Recheck ownership and verify actual EPUB bytes. If needed, repair and finalize that exact entry in BookOrbit, then recheck. ShelfScout does not repeat finalize, even after an explicit failure, because partial upstream work may exist. A metadata match without byte evidence cannot recover an uncertain import.
- Import completed directly in BookOrbit: download tracking and Book Dock waiting check library ownership before requiring the incoming file, which BookOrbit may already have moved. The library book must match the requested title, author, language and explicit ISBN and contain an EPUB. If ShelfScout recorded the delivered file, the imported bytes must also match its saved checksum and target library, even when ShelfScout did not initiate finalization. Blocked download/import requests get an ownership-only background check every five minutes while the worker runs; successful verification resumes Kobo collection processing. These background checks do not retry downloads, rescan Book Dock or repeat imports, and preserve the original error when ownership is absent or unavailable. Recheck performs the lookup immediately.
- Collection failure: restore the target's permissions/Kobo eligibility, then recheck. Membership reads recover a lost POST response without adding another download/import.
- Unresolved legacy request: review BookOrbit Requests; no automatic migration into a new download.

Stages stop for review after 24 hours. Recheck renews the observation window and, only while tracking a submitted download, authorizes one retry if the checks above establish a retryable failure. Import submissions are never repeated. Read/API failures surface sanitized actionable errors. Large history/listing bounds or upstream schema changes fail closed. Once a checksum or generation conflict is detected, manual investigation may be necessary; the UI deliberately cannot override identity evidence. Back up the entire database, not only public Activity JSON, to preserve correlation and submission markers.

## Live verification still required

Before normal acquisition, verify installed versions against the source snapshots, session/JWT lifetime and permissions, source download policy, flat completed-folder delivery, physical host mounts, UID permissions, disabled auto-finalization, destination IDs and collection access. Then, when explicitly authorized, use a release you are entitled to download to exercise the full chain, including a worker restart and collection read-back. No such live acquisition was performed during implementation.

## Recommendation and rating sources

Open Library discovery remains server-side, bounded and cached. Goodreads averages imported from CSV remain snapshots with unknown measurement time. Live Goodreads/Amazon averages and counts now come from BookOrbit’s read-only metadata provider search, matched by title/author and cached with source URLs and retrieval dates. Enable those providers in BookOrbit and configure automatic login; see the recommendation guide for lookup and refresh behavior. Neither source is scraped and ratings outages never block history or acquisition. Recommendation architecture is documented in [recommendation-system.md](recommendation-system.md).
