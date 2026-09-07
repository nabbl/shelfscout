# CI, GHCR images, and Arcane GitOps

The `CI and GHCR` GitHub Actions workflow runs on pull requests to `main`, pushes to `main`, and manual dispatch. Only a successful run on the current `main` revision can publish. Pull requests (including forks) get read-only checks and cannot publish images or update deployment configuration.

## Release gates

- Clean `npm ci` on Node 22 using the committed lockfile; npm audit blocks high/critical dependency advisories, including development tools that the current runtime image contains.
- Actionlint, shell syntax validation, and resolved Compose contract checks for local builds, Arcane builds, GHCR pulls, and optional DockTail overrides.
- ESLint, Next route type generation, TypeScript, unit/migration tests, and a production Next build.
- Chromium browser tests on desktop and mobile, both demo flows and authenticated isolated synthetic fixtures. `test:browser:live` is the fixture suite; it does not use the owner's BookOrbit, Shelfmark, model, or database. Focused tests (`test.only`) fail CI.
- Native Linux amd64 and arm64 Docker builds and smoke tests of the actual final images: non-root web/worker startup, HTTP health, anonymous API rejection, native SQLite, migrations, shared volume persistence, and graceful worker shutdown. Containers use disposable volumes on an internal network with no external integrations.
- Grype scans both final images and blocks high/critical vulnerabilities with available fixes. This threshold does not certify the absence of unfixed vulnerabilities. Scan reports and browser failure evidence are retained for seven days.

All gates must pass before the publishing job starts. The publisher loads the exact checked image archives; it does not rebuild them. Third-party actions are pinned to commit SHAs and Dependabot checks for action updates weekly. Each job receives only its required token permissions; no personal access token, app credentials, or Arcane secret is needed by the workflow.

The runtime image applies Debian updates and removes the global npm/npx installation, including its bundled dependencies. Build stages retain npm for installation and compilation. Start the runtime web and worker with their supplied Node commands, not `npm start` or `npm run worker` inside the container.

Recommended required PR checks are `Application checks`, `Container checks (amd64)`, and `Container checks (arm64)`. Configure these in your branch rules if you want merges to require CI; the pipeline does not change repository protection settings.

## Published images

For this repository, successful `main` builds publish:

```text
ghcr.io/nabbl/shelfscout:main
ghcr.io/nabbl/shelfscout:latest
ghcr.io/nabbl/shelfscout:sha-<full-source-commit>
```

Each is a multi-platform image for `linux/amd64` and `linux/arm64`. Per-architecture `sha-<commit>-amd64` and `sha-<commit>-arm64` tags are also published. The workflow summary records the manifest digest. The `main` and `latest` tags move after successful checks; a digest is the stable deployment reference. A manually rerun old commit is refused if it is no longer the current `main` head.

The workflow authenticates with GitHub's built-in `GITHUB_TOKEN`. GitHub may create a new GHCR package as private even when the repository is public. After the first publication, either make the package public in its GitHub package settings for anonymous pulls, or configure Arcane's GHCR credentials with an account/token allowed to read it. See [GitHub's Container registry guide](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry). An existing package must grant this repository Actions write access.

## Arcane GitOps

After image publication, the workflow updates **`codex/ghcr-deploy`**, a generated deployment branch containing `compose.yml`. Both web and worker reference the same published image digest. The branch is updated only after all checks and image publication succeed; each manifest includes its source commit. The workflow does not contact Arcane or start/restart any deployment.

When configuring Arcane, use:

| Setting | Value |
| --- | --- |
| Repository | `https://github.com/nabbl/shelfscout.git` |
| Branch | `codex/ghcr-deploy` |
| Compose path | `compose.yml` |
| Image | Digest already supplied by the generated manifest |

Wait for the first workflow to finish before creating the sync. Keep passwords, tokens, model settings, incoming host paths, and other private configuration in Arcane's Environment editor, using the variables in [Arcane setup](arcane.md). The runtime still needs the existing shared incoming directory and BookOrbit/Shelfmark configuration for acquisitions. Use the existing Arcane project and volume identity when migrating an installation; creating a differently named project may create a new empty database volume.

Enable Arcane's desired pull/redeploy-on-sync behavior when you are ready for automatic deployments. The digest changes the Compose content after each release, avoiding the race where Arcane syncs `main` while its image is still building. No build context is needed: the generated configuration has no `build` block and uses `pull_policy: always`.

Treat `codex/ghcr-deploy/compose.yml` as generated: the pipeline overwrites it on release. For private DockTail labels or custom networks, keep a Compose file in your own private GitOps repository and update its image digest from the workflow summary; do not rely on editing a GitOps-managed file locally. That private repository can instead track `:main` if you deliberately configure registry image update polling, but a Git sync alone may not notice a mutable tag change.

The generic `deploy/compose.ghcr.yml` on `main` is also usable directly. Its `SHELFSCOUT_IMAGE` override accepts a full `ghcr.io/...@sha256:...` reference for manually pinned deployments or rollbacks. The generated branch always pins the release digest and does not accept that override. To roll back, use the prior successful image digest in your deployment configuration; consider database migration compatibility before returning to older application versions.

Local configuration checks (no running Docker daemon required):

```bash
python3 scripts/ci/check-compose.py
docker compose -f deploy/compose.ghcr.yml config --quiet
```
