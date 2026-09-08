<p align="center">
  <img src="public/icons/icon-192.png" alt="ShelfScout: an S inside a magnifying glass" width="128" height="128" />
</p>

# ShelfScout

ShelfScout is a private, self-hosted book-discovery companion. It imports Goodreads history, finds real candidates through Open Library, explains inspectable fit/caveat evidence, and orchestrates Shelfmark release search/download followed by verified BookOrbit Book Dock import and Kobo collection membership. Existing BookOrbit Requests continue to reconcile.

## Start locally

Requirements: Node.js 22.13+.

```bash
cp .env.example .env
# Set a password hash (escape each $ as \$ for Next.js), SESSION_SECRET, local DATA_DIR/SHELFSCOUT_DB paths, and optional model/BookOrbit connection.
npm ci
npm run db:migrate
npm run dev
# In a second terminal:
npm run worker
```

Generate the owner password entry for local Next.js development and paste it into `.env`:

```bash
node -e 'require("bcryptjs").hash(process.argv[1],12).then(hash => console.log("OWNER_PASSWORD_HASH=" + hash.replaceAll("$", "\\$")))' 'your password'
```

Next.js expands `$` references even inside quoted `.env` values, so quoting a bcrypt hash alone is insufficient: each `$` must be written as `\$`. `.env.local` takes precedence over `.env`; update or remove a duplicate entry there too, then restart the server. Container runtime environment variables should contain the original bcrypt hash, without Next.js-specific backslash escaping.

For automatic BookOrbit login, set `BOOKORBIT_USERNAME` and `BOOKORBIT_PASSWORD` in `.env.local` alongside `BOOKORBIT_URL`. Alternatively set `BOOKORBIT_PASSWORD_FILE` to a plain-text password file; its contents are used literally (one trailing newline is removed). In `.env` passwords, escape literal `$` as `\$`. These credentials take precedence over `BOOKORBIT_TOKEN`; tokens are renewed automatically. `npm run worker` uses the same environment-file precedence as Next.js. Restart web and worker after configuration changes.

Use `docker compose up --build` for the packaged deployment. The UI is at `http://localhost:3000`; `/api/health` is available for container checks. Both development and production refuse to create sessions unless `SESSION_SECRET` has at least 32 characters. Set `DEMO_MODE=true` only for the visibly labelled, non-live demonstration, and put a rate-limiting reverse proxy in front of an internet-exposed instance.

For private HTTPS access, see [Tailscale / DockTail setup](docs/tailscale.md), including a gitignored Compose override and private Arcane configuration.

For prebuilt amd64/arm64 images and Arcane GitOps, see [CI / GHCR setup](docs/ci.md). GitHub Actions checks the app and containers before publishing to `ghcr.io/nabbl/shelfscout` and updating a digest-pinned deployment branch.

Series recommendations start at a verified book one. In Settings, turn off **Allow books that are part of a series** to exclude known series. Click a series label or use Check series in book details to browse the available reading order. Get the verified first book, one listed book, or a selection with one language and Kobo collection choice. Unread books are selected by default; known owned/requested books are skipped. Each book has its own Activity entry. Series lists may be incomplete and are never presented as a guaranteed complete set. Discover offers removable mood suggestions backed by reading history or saved preferences; **Clear mood** returns to your usual taste.

Click a recommendation’s cover to open its details. The card’s X opens feedback choices: Already read, Not now (30 days), or Not interested. Opening or cancelling the chooser leaves the book unchanged.

In History, change a book’s reading status directly or click its title to open its cover and details. Read, Want to read, Currently reading, Did not finish, and On hold are saved locally across Goodreads reimports; choose the Goodreads option to restore the source value. Covers use a valid imported ISBN, with an exact title/author catalog match as fallback. Status corrections inform subsequent recommendations.

Set **Reading languages** in Settings to choose the languages you read (English by default). Discovery searches and both new and existing recommendations require matching catalog language metadata; unknown languages are withheld. Multilingual works use one of your selected languages for acquisition. Catalog work titles may still use the original language; the requested release language is checked separately. Search is available inside History.

Recommendation badges describe the available evidence: **Matches your interests** covers broad or tentative overlap; **Strong fit** requires description-backed matches to at least two distinct, specific preferences across different dimensions, with no recorded conflict. Those preferences must be explicit or supported by multiple positively rated works without counterexamples. Genre, author, subject tags, and mood alone cannot earn Strong fit. **Wildcard** flags a match with a conflict; **Discovery** has insufficient preference evidence. Existing batches are relabelled when displayed.

## Install as an app

Open your ShelfScout HTTPS address and choose **Install app** in a supported browser, or **Share → Add to Home Screen** in Safari on iPhone/iPad. ShelfScout opens in its own window with the new home-screen icon. It requires a connection to your ShelfScout server; offline reading and background sync are not provided.

The approved [logo artwork](public/brand/shelfscout-icon-v3.png) supplies the app, favicon, Apple touch icon, and standard/maskable PWA icons. Regenerate the icon sizes with `node scripts/generate-brand-icons.mjs`.

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

See [integration evidence](docs/integrations.md), the [implemented plan](docs/implementation-plan.md), and the [recorded verification results](docs/test-results.md). A live acquisition requires BookOrbit and Shelfmark credentials, an explicit library/folder target, a shared incoming directory, and an existing Kobo-enabled collection. Follow the [acquisition setup and recovery guide](docs/integrations.md) and [Arcane setup](docs/arcane.md). Setup and tests never perform live acquisition or collection changes. The release picker hides incompatible hits and shows up to five compatible results, prioritizing exact edition matches. Authenticated browser tests use a separate `.next-browser` build directory, so they can run alongside the development app.
