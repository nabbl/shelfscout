# Arcane setup

**For prebuilt GHCR images and GitOps, use [CI / GHCR setup](ci.md).** The pipeline maintains a digest-pinned `compose.yml` on `codex/ghcr-deploy`; the source-build instructions below remain available as an alternative.

For private HTTPS access using DockTail labels in Arcane's saved configuration, see [Tailscale / DockTail setup](tailscale.md). No deployment-specific labels need to be committed to the public base Compose files.

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

## Local image pull errors

`shelfscout:local` is the output tag of the source build, not a published registry image. Both Compose files set `pull_policy: build` on web and worker so Compose builds the configured context instead of trying Docker Hub first. See [Docker's build/pull rules](https://docs.docker.com/reference/compose-file/build/#using-build-and-image).

If Arcane stores its own copy of the Compose YAML, update that copy as well: add `pull_policy: build` beside `image: shelfscout:local` in `x-shelfscout`. Updating the Git build context alone updates application source, not Arcane's saved service configuration. Use the project's Build / Build & Deploy operation; an explicit image-only Pull operation cannot produce an unpublished local image. Ensure `SHELFSCOUT_BUILD_CONTEXT` is the repository URL with `#main` (or the reviewed commit), rather than the old Arcane setup branch.

## Dependency installation fails immediately

The 2026-09-07 `npm ci` failure was reproduced in an isolated checkout using Node 22.23.2 / npm 10.9.9: npm rejected the lockfile with `EUSAGE`, reporting missing `@emnapi/runtime@1.11.3` and `@emnapi/core@1.11.3`. Checking only the root dependency declarations or using an npm 11 dry run did not reveal these missing transitive entries. The lockfile has been repaired with npm 10, preserving existing dependency versions. A full clean install and application validation now pass with Node 22 / npm 10.

Keep the Git build context on the updated `main` revision and retry Build after pulling the fix. The Dockerfile prints Node/npm versions and runs install scripts in the foreground to improve diagnostics. If the deployment progress panel still shows only a final exit status, inspect the build's output in Images → Builds → Build History. Do not delete the lockfile or switch production builds to `npm install` to bypass a failed check. Future dependency changes should be checked with a clean `npm ci` using the Node 22/npm 10 toolchain used by the Docker base image, as well as the production build.
