# Arcane setup

The `shelfscout` Arcane project uses `deploy/compose.arcane.yml`, building the application directly from `https://github.com/nabbl/shelfscout.git#codex/arcane-setup`. No image registry is required. This is a Compose-managed project with a remote Git build context; use Build to pick up source changes. It is intentionally not deployed until owner configuration is entered.

In the project's Environment editor, fill in:

- `OWNER_PASSWORD_HASH`: bcrypt hash, single-quoted to preserve dollar signs.
- `SESSION_SECRET`: at least 32 random characters.
- `MODEL_BASE_URL`, `MODEL_NAME`, `MODEL_API_KEY`: your OpenAI-compatible provider; API key may be empty for a local provider without authentication.
- `BOOKORBIT_URL`, `BOOKORBIT_TOKEN`: when enabling acquisition.
- Optional `SHELFMARK_URL`, `SHELFMARK_COOKIE`.
- `SHELFSCOUT_PORT`: an available host port, default 3000. Use your existing HTTPS reverse proxy for production login cookies.

Keep `SHELFSCOUT_BUILD_CONTEXT` set to the branch URL above, or pin a reviewed commit. Choose Build / Build & Deploy in Arcane after saving configuration. Both services share the project-scoped `shelfscout-data` volume; the web health check gates worker startup. Container data paths are fixed to `/data` and do not need environment edits. Demo mode is disabled in this deployment.

For a local checkout, `compose.yml` builds `.` by default. Both Compose configurations were validated with Docker Compose config. Runtime container validation requires a Docker daemon; the local daemon was unavailable during setup.
