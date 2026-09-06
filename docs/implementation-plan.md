# ShelfScout implementation plan

1. Verify BookOrbit and Shelfmark routes, authentication, permissions, and acquisition boundaries against source; record live-test limits.
2. Build a private owner-only Next.js application with SQLite migrations, health endpoint, durable jobs, CSRF, and server-only secrets.
3. Import Goodreads CSVs through preview and confirmation, preserving raw data and exact row outcomes on idempotent reimport.
4. Discover real candidates through Open Library, exclude known/dismissed works, diversify authors, rank with inspectable taste evidence, and retain feedback.
5. Use BookOrbit Requests as the sole acquisition owner; reconcile request/import state in a worker and confirm EPUB plus Kobo-synced collection membership before “Ready for Kobo.”
6. Cache/source ratings honestly, provide Goodreads/Amazon links, and show unknown/stale/provider-error states without blocking other features.
7. Verify unit, integration, production build, browser flows, and container health; document any live-credential blockers precisely.

Low-risk decisions: Goodreads records remain independent from BookOrbit files; Open Library is the first candidate catalog; Shelfmark is connection-only in this release; no request is submitted without an explicit owner click; demo data is development-only and visibly labelled.

