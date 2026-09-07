#!/usr/bin/env bash
# Disposable CI containers only; no owner data, credentials, or external integrations.
set -euo pipefail
image=${1:?Usage: container-smoke.sh IMAGE}
prefix="shelfscout-ci-${GITHUB_RUN_ID:-local}-${RANDOM}"
web="${prefix}-web"
worker="${prefix}-worker"
volume="${prefix}-data"
network="${prefix}-network"
cleanup() {
  result=$?
  trap - EXIT
  if [ "$result" -ne 0 ]; then
    docker logs "$web" 2>&1 || true
    docker logs "$worker" 2>&1 || true
  fi
  docker rm -f "$web" "$worker" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  exit "$result"
}
trap cleanup EXIT
docker network create --internal "$network" >/dev/null
docker volume create "$volume" >/dev/null
owner_hash=$(docker run --rm --network none "$image" node -e 'console.log(require("bcryptjs").hashSync("ci-only-password", 4))')
common=(--network "$network" --mount "type=volume,src=$volume,dst=/data"
  -e NODE_ENV=production -e DEMO_MODE=false -e DATA_DIR=/data
  -e "OWNER_PASSWORD_HASH=$owner_hash"
  -e SHELFSCOUT_DB=/data/shelfscout.sqlite
  -e SESSION_SECRET=ci-only-disposable-session-secret-at-least-32-characters)
docker run -d --name "$web" "${common[@]}" "$image" >/dev/null
ready=false
for ((attempt=0; attempt<60; attempt++)); do
  if docker exec "$web" node -e 'fetch("http://127.0.0.1:3000/api/health").then(async r=>{const b=await r.json();if(!r.ok||b.database!=="ok")process.exit(1)}).catch(()=>process.exit(1))' >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
[ "$ready" = true ] || { echo 'Web health check failed'; exit 1; }
docker exec "$web" node -e '
  const assert = require("node:assert/strict");
  assert.equal(process.getuid(), 1001);
  (async () => {
    const login = await fetch("http://127.0.0.1:3000/");
    assert.equal(login.status, 200);
    assert.match(await login.text(), /[Pp]assword/);
    const privateApi = await fetch("http://127.0.0.1:3000/api/export");
    assert.equal(privateApi.status, 401);
    const signedIn = await fetch("http://127.0.0.1:3000/api/auth/login", {
      method: "POST", headers: {"content-type":"application/json"},
      body: JSON.stringify({password:"ci-only-password"})
    });
    assert.equal(signedIn.status, 200);
    const cookie = signedIn.headers.get("set-cookie");
    assert.match(cookie, /; Secure/i);
    assert.match(cookie, /; HttpOnly/i);
  })().catch(e => { console.error(e); process.exit(1); });
'
docker run -d --name "$worker" "${common[@]}" "$image" node --import tsx server/worker.ts >/dev/null
sleep 3
[ "$(docker inspect --format '{{.State.Running}}' "$worker")" = true ]
docker exec "$worker" node -e '
  const assert = require("node:assert/strict");
  assert.equal(process.getuid(), 1001);
  const db = require("better-sqlite3")("/data/shelfscout.sqlite");
  for (const table of ["jobs", "acquisition_flows", "acquisition_targets"])
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type=? AND name=?").get("table", table));
  assert.equal(db.pragma("integrity_check", {simple:true}), "ok");
  db.exec("CREATE TABLE ci_persistence (value TEXT)");
  db.prepare("INSERT INTO ci_persistence VALUES (?)").run("survives-restart");
  db.close();
'
docker stop --time 15 "$worker" >/dev/null
[ "$(docker inspect --format '{{.State.ExitCode}}' "$worker")" = 0 ]
docker restart "$web" >/dev/null
docker exec "$web" node -e '
  const db = require("better-sqlite3")("/data/shelfscout.sqlite");
  require("node:assert/strict").equal(db.prepare("SELECT value FROM ci_persistence").get().value, "survives-restart");
  db.close();
'
echo 'Web, worker, native SQLite, migrations, non-root user, authentication boundary, persistence and graceful worker shutdown passed.'
