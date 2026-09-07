# ShelfScout

ShelfScout is a private, self-hosted book-discovery companion. It imports Goodreads history, finds real candidates through Open Library, explains inspectable fit/caveat evidence, and orchestrates Shelfmark release search/download followed by verified BookOrbit Book Dock import and Kobo collection membership. Existing BookOrbit Requests continue to reconcile.

## Start locally

Requirements: Node.js 22.13+.

```bash
cp .env.example .env
# Set a password hash (single-quoted), SESSION_SECRET, local DATA_DIR/SHELFSCOUT_DB paths, and optional model/BookOrbit connection.
npm ci
npm run db:migrate
npm run dev
# In a second terminal:
npm run worker
```

Generate the owner password hash:

```bash
node -e "require('bcryptjs').hash(process.argv[1],12).then(console.log)" 'your password'
```

Use `docker compose up --build` for the packaged deployment. The UI is at `http://localhost:3000`; `/api/health` is available for container checks. Both development and production refuse to create sessions unless `SESSION_SECRET` has at least 32 characters. Set `DEMO_MODE=true` only for the visibly labelled, non-live demonstration, and put a rate-limiting reverse proxy in front of an internet-exposed instance.

For private HTTPS access, see [Tailscale / DockTail setup](docs/tailscale.md), including a gitignored Compose override and private Arcane configuration.

## Data boundaries

- The original Goodreads CSV is private under `DATA_DIR/imports`; raw columns are preserved and import never triggers acquisition.
- Personal rating `0` is unrated. ISBN wrappers are text, never formulas; original and parsed values are retained.
- Reimport matches Goodreads IDs, updates source fields, preserves companion feedback, never deletes absent records, and accounts for every row.
- BookOrbit stays authoritative for files and Kobo delivery. ShelfScout never changes Kobo settings or claims device delivery.
- No telemetry is enabled. AI interprets bounded positive and negative evidence, plans discovery and assesses catalog works. Review sharing is off by default and editable in Settings. See [recommendation architecture, configuration and limits](docs/recommendation-system.md).

## Backup, restore, deletion

Stop web and worker together, then copy the entire `DATA_DIR` (database plus original imports). Restore by replacing it while both processes are stopped. For full deletion, stop the deployment and remove its `shelfscout-data` volume. SQLite uses WAL mode and a busy timeout for the shared web/worker volume.

## Verification

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run test:browser
npm run test:browser:live
npm run evaluate
```

See [integration evidence](docs/integrations.md), the [implemented plan](docs/implementation-plan.md), and the [recorded verification results](docs/test-results.md). A live acquisition requires BookOrbit and Shelfmark credentials, an explicit library/folder target, a shared incoming directory, and an existing Kobo-enabled collection. Follow the [acquisition setup and recovery guide](docs/integrations.md) and [Arcane setup](docs/arcane.md). Setup and tests never perform live acquisition or collection changes.
