"""Validate deploy contracts without printing interpolated secrets or starting services."""
import json
import os
import subprocess


def config(*files):
    command = ["docker", "compose"]
    for file in files:
        command.extend(["-f", file])
    return json.loads(subprocess.check_output(command + ["config", "--format", "json"]))


for base in ("compose.yml", "deploy/compose.arcane.yml", "deploy/compose.ghcr.yml"):
    services = config(base)["services"]
    assert set(services) == {"web", "worker"}
    web, worker = services["web"], services["worker"]
    assert web["image"] == worker["image"]
    assert web["healthcheck"]["test"]
    assert worker["depends_on"]["web"]["condition"] == "service_healthy"
    assert worker["command"] == ["node", "--import", "tsx", "server/worker.ts"]
    assert not worker.get("ports") and not worker.get("labels")
    assert not web.get("labels")
    web_data = next(v for v in web["volumes"] if v["target"] == "/data")
    worker_data = next(v for v in worker["volumes"] if v["target"] == "/data")
    assert web_data == worker_data
    assert not any(v["target"] == "/incoming" for v in web["volumes"])
    assert next(v for v in worker["volumes"] if v["target"] == "/incoming")["read_only"]
    for service in services.values():
        if base.endswith("compose.ghcr.yml"):
            assert "build" not in service
            assert service["pull_policy"] == "always"
        else:
            assert service["build"]["dockerfile"] == "Dockerfile"
            assert service["pull_policy"] == "build"
    overlay = config(base, "deploy/compose.docktail.example.yml")["services"]
    assert not overlay["web"].get("ports")
    assert overlay["web"]["labels"]["docktail.service.service-protocol"] == "https"
    assert overlay["worker"] == worker
    print(f"Validated {base} and optional DockTail overlay")

os.environ["SHELFSCOUT_IMAGE"] = "ghcr.io/example/shelfscout@sha256:" + "a" * 64
for service in config("deploy/compose.ghcr.yml")["services"].values():
    assert service["image"] == os.environ["SHELFSCOUT_IMAGE"]
print("Validated image digest override for both services")
