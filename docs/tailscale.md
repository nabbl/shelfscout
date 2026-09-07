# Private access through Tailscale / DockTail

Keep deployment-specific labels in your private Arcane project configuration or a gitignored local Compose override. The base Compose files remain generic; `deploy/compose.docktail.example.yml` is an optional template. Only `web` needs labels. Do not put them in `x-shelfscout`, since the worker inherits that anchor too.

## Existing DockTail setup

These instructions assume DockTail already watches the Docker host running ShelfScout, and its Tailscale service host can reach ShelfScout's Docker network. DockTail's default direct mode forwards to the container IP, so no published host port is needed. For host/sidecar networking, service creation permissions, service approval, tailnet access rules, and HTTPS prerequisites, follow the [DockTail setup guide](https://docktail.org/docs/).

Use HTTPS on the Tailscale-facing service and HTTP to the application on container port 3000. ShelfScout's production session and CSRF cookies require HTTPS. Keep the normal owner password and session secret configured. Tailscale/OAuth credentials belong in the existing DockTail setup, not ShelfScout.

## Arcane

In Arcane's saved project Compose YAML, add this `labels` mapping under the existing `services.web`, alongside its `ports` and `healthcheck` entries:

```yaml
    labels:
      docktail.service.enable: "true"
      docktail.service.name: "${DOCKTAIL_SERVICE_NAME:-shelfscout}"
      docktail.service.port: "3000"
      docktail.service.protocol: "http"
      docktail.service.service-port: "443"
      docktail.service.service-protocol: "https"
```

Optionally set `DOCKTAIL_SERVICE_NAME` in Arcane's Environment editor to your desired service name. Remove the entire `ports` entry from `web` if access should go only through DockTail. Keep the health check: it runs inside the container and still works without a published port.

This is a private edit to Arcane's saved deployment configuration. The remote Git build context can stay `https://github.com/nabbl/shelfscout.git#main`; these labels do not need to be committed to the public repository. A Git build-context update does not add or remove labels in Arcane's saved YAML. When you choose to apply the configuration, recreate/deploy the services so Docker receives the labels; an image build alone does not change existing container labels.

## Local Compose override

From the repository root, copy the template and customize the copy:

```bash
cp deploy/compose.docktail.example.yml compose.docktail.local.yml
# Optional: set DOCKTAIL_SERVICE_NAME in your private .env file.
docker compose -f compose.yml -f compose.docktail.local.yml config --quiet
```

The copy and `.env` are gitignored. The example uses Docker Compose's [`!reset []`](https://docs.docker.com/reference/compose-file/merge/#reset-value) to remove the base file's host port; a plain empty list does not clear inherited ports. Use a Compose version supporting `!reset` and verify the merge before deployment.

When ready to deploy, use the same file list:

```bash
docker compose -f compose.yml -f compose.docktail.local.yml up -d --build
```

Use both `-f` arguments for subsequent Compose operations. Alternatively, name the private copy `compose.override.yml` for automatic loading by plain `docker compose` commands. When using `-f` explicitly, include the override explicitly too.

## Verify access

After applying the configuration, check DockTail's logs and the Tailscale service entry for the configured name. From a device connected to your tailnet, open `https://shelfscout.<your-tailnet>.ts.net` (substitute your chosen service name and tailnet DNS suffix), check `/api/health`, then sign in. The example enables a private Tailscale Service; it does not enable public Funnel access.

If DockTail finds the labels but the backend is unreachable, check that the Tailscale service host can route to the web container's Docker network. For a Tailscale sidecar this can require a shared Docker network. For setups requiring DockTail's legacy published-port mode, retain an appropriate host port binding and set `docktail.service.direct: "false"` in your private configuration instead of using the port-removing overlay. See the DockTail guide for the networking requirements of your setup.
