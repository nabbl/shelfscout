# Arcane setup

The Arcane project uses `deploy/compose.arcane.yml`. The checkout was clean on `main` and fast-forwarded from `cd8deb6` to `e6fcff0` before the acquisition change. The previous `codex/arcane-setup` branch still exists, but its setup is already present on main. The Compose default now builds `https://github.com/nabbl/shelfscout.git#main`; pin a reviewed commit for reproducible deployment. Remote builds use the published revision on `main`; pin the reviewed acquisition commit before deploying. Publishing source does not deploy the application. No deploy or service restart was performed.

Set these in Arcane's Environment editor:

- `OWNER_PASSWORD_HASH`: bcrypt hash, single-quoted to preserve dollar signs.
- `SESSION_SECRET`: at least 32 random characters.
- `MODEL_BASE_URL`, `MODEL_NAME`, `MODEL_API_KEY`: your existing provider configuration; the API key can be empty for an unauthenticated local provider.
- `BOOKORBIT_URL`, `BOOKORBIT_TOKEN`: an existing bearer JWT with the capabilities listed in [integration setup](integrations.md).
- `BOOKORBIT_LIBRARY_ID` and `BOOKORBIT_FOLDER_ID`: the final library and its folder, not the Book Dock staging directory.
- `BOOKORBIT_DOCK_DIR`: actual BookOrbit container-side Book Dock path, e.g. `/book-dock`.
- `SHELFMARK_URL`, `SHELFMARK_COOKIE`: reachable instance and existing authenticated session cookie. Shelfmark is required for new unowned acquisitions.
- `SHELFMARK_OUTPUT_DIR`: Shelfmark's completed folder destination, e.g. `/books`.
- `SHELFSCOUT_INCOMING_HOST_DIR`: absolute existing host path, e.g. `/srv/books/incoming`.
- Optional `SHELFSCOUT_PORT`, default 3000. Use your HTTPS reverse proxy for production login cookies.

The worker gets `/srv/books/incoming:/incoming:ro` and fixes `SHELFSCOUT_INCOMING_DIR=/incoming`. Map that **same host directory** writable into Shelfmark as `/books` and BookOrbit as `/book-dock`. Keep the final BookOrbit library in a separate host directory, e.g. `/srv/books/library`. Only the ShelfScout worker mounts incoming; the web process does not. Ensure UID 1001 can read it. Without a host path, Compose uses an empty named fallback volume for recommendation-only operation; it is not a working acquisition configuration.

Configure flat single-EPUB folder output in Shelfmark and disable Book Dock auto-finalization yourself before enabling this workflow. ShelfScout verifies these boundaries where the API permits and never changes upstream/Kobo settings. All detailed auth contracts, exact routes, permissions, format constraints and recovery instructions are in [integrations.md](integrations.md).

Both services share the project-scoped `shelfscout-data` SQLite volume. Container database paths stay `/data`; web health gates worker startup. Existing records are migrated additively and pending BookOrbit requests remain tracked. Configure network access to the existing services using your deployment's host URLs or external network; the Compose file does not deploy Shelfmark or BookOrbit.

For local source builds, `compose.yml` builds `.` by default. For Arcane, save the configuration and choose Build / Build & Deploy only when you intend to deploy a published, reviewed revision. Development validation uses Compose configuration inspection only, not running containers or downloading books.
