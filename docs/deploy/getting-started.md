<!--
  SPDX-FileCopyrightText: 2026 project-agi contributors
  SPDX-License-Identifier: Apache-2.0
-->

# Getting started — local + Kubernetes

This doc walks you from a clean machine to a running project-agi
deployment. Two paths are supported out of the box:

- **Docker Compose** — single-host, good for laptops and demos.
- **Helm on kind / a real cluster** — production-shaped, what CI tests.

---

## Path A — Docker Compose

```bash
git clone https://github.com/comviva-oss/project-agi
cd project-agi
docker compose -f deploy/docker-compose.yaml up -d
```

What you get:

- `agi-runtime` on `http://localhost:9000`
- `agi-ui` admin console on `http://localhost:8080`
- MongoDB, Qdrant, and a Keycloak realm wired up
- The bundled `packs/telco-demo` pack mounted into the runtime

Verify:

```bash
curl http://localhost:9000/healthz
curl http://localhost:9000/readyz
```

Switch packs by editing `deploy/docker-compose.yaml` and pointing the
runtime's `/packs` mount at `packs/fleet-demo`.

Tear down:

```bash
docker compose -f deploy/docker-compose.yaml down -v
```

---

## Path B — Helm on kind

Prerequisites: Docker, `kind` >= 0.24, `kubectl`, `helm` >= 3.16.

```bash
kind create cluster --name agi
docker build -t agi-runtime:dev -f distribution/agi-runtime/Dockerfile .
kind load docker-image agi-runtime:dev --name agi

helm install agi distribution/agi-chart \
  --namespace agi --create-namespace \
  --set runtime.image.repository=agi-runtime \
  --set runtime.image.tag=dev \
  --set runtime.image.pullPolicy=Never \
  --set runtime.replicaCount=1 \
  --set runtime.autoscaling.enabled=false \
  --set runtime.pdb.enabled=false \
  --set ui.enabled=false \
  --set auth.mode=dev-noop \
  --set runtime.env.AGI_ENV=development \
  --set llm.provider=fake \
  --set observability.otelCollector.enabled=false \
  --set networkPolicy.enabled=false \
  --wait
```

Run the bundled Helm smoke test:

```bash
helm test agi --namespace agi --logs
```

Mount a real pack:

```bash
helm upgrade agi distribution/agi-chart \
  --reuse-values \
  --set-file packs.config=packs/telco-demo/pack.yaml
```

Tear down:

```bash
helm uninstall agi --namespace agi
kind delete cluster --name agi
```

---

## What to read next

- `docs/deploy/helm.md` — every `values.yaml` field documented.
- `docs/deploy/hotfix.md` — pack hotfix lane.
- `docs/packs/authoring.md` — how a pack is built.
