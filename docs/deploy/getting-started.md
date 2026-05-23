<!--
  SPDX-FileCopyrightText: 2026 project-agi contributors
  SPDX-License-Identifier: Apache-2.0
-->

# Getting started

project-agi has two entry points. Pick the one that matches your goal:

- **SDK path** — embed `agi-sdk` in your own service. No FastAPI, no UI, no Docker required. ~5 minutes.
- **Turnkey path** — bring up the full reference stack (runtime + UI + Mongo + Qdrant + Langfuse + OTel) with `docker compose`. ~5 minutes after the first image pull.

If you have never seen project-agi before, start with the SDK path.

---

## SDK path — `pip install` to first invocation

### 1. Install

From PyPI (once v1.0 ships):

```bash
pip install agi-sdk
```

Or from a checkout of this repo (the workflow most contributors use):

```bash
git clone https://github.com/<org>/project-agi
cd project-agi
pip install -e packages/agi-sdk
```

### 2. Pick a pack

A pack is a folder of YAML/J2/JSON describing one tenant's tools, prompts, KB, and model bindings. Copy one of the demonstrators, or start from the blank template:

```bash
cp -r packs/care-demo                  ./my-pack       # full-featured demo
# or
cp -r packages/agi-packs/blank          ./my-pack       # empty skeleton
```

Edit `my-pack/pack.yaml` to set your pack `slug` and at least one model role binding.

### 3. Write a use case

```python
# bill_explainer.py
import litellm
from agi_sdk import use_case, serve

@use_case("bill_explainer", version="0.3.0")
class BillExplainer:
    def __init__(self, sdk):
        self.sdk       = sdk
        self.reasoning = sdk.models.binding("reasoning")
        self.billing   = sdk.mcp.tool("billing.adjust_charge")

    async def handle(self, request, ctx):
        prompt   = self.sdk.prompts.get("explain_bill").render(**request.payload)
        response = await litellm.acompletion(
            messages=[{"role": "user", "content": prompt}],
            **self.reasoning.kwargs(),
        )
        return response

if __name__ == "__main__":
    serve(BillExplainer, http=True)
```

### 4. Run it

```bash
AGI_PACK_DIR=./my-pack python bill_explainer.py
```

Then in another shell:

```bash
curl http://localhost:9000/v1/info
curl -X POST http://localhost:9000/v1/invoke \
  -H 'Content-Type: application/json' \
  -d '{"use_case": "bill_explainer", "payload": {"account_id": "A123"}}'
```

That's it. The SDK takes one pack at a time — multi-pack `X-Pack` dispatch is the runtime's job (next section).

---

## Turnkey path — the full reference stack

For multi-tenant deployments, the admin console, X-Pack dispatch, Langfuse traces, and the audit trail:

```bash
git clone https://github.com/<org>/project-agi
cd project-agi/deploy/docker
docker compose up -d
```

What you get:

- `agi-runtime` on `http://localhost:9000` (FastAPI + MCP + claims-validated X-Pack dispatch)
- `agi-ui` admin console on `http://localhost:8080`
- MongoDB, Qdrant, Langfuse, OTel collector — all pre-wired
- The bundled `packs/care-demo` and `packs/fleet-demo` packs mounted into the runtime

Verify:

```bash
curl http://localhost:9000/healthz
curl http://localhost:9000/readyz
open http://localhost:8080
```

Switch packs at request time with the `X-Pack` header:

```bash
curl -H 'X-Pack: fleet-demo' http://localhost:9000/v1/info
```

Tear down:

```bash
docker compose down -v
```

---

## Helm on kind (production-shaped)

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

helm test agi --namespace agi --logs
```

Tear down:

```bash
helm uninstall agi --namespace agi
kind delete cluster --name agi
```

---

## What to read next

- `docs/deploy/helm.md` — every `values.yaml` field documented.
- `docs/deploy/hotfix.md` — pack hotfix lane (≤15 min merge-to-live target).
- `docs/packs/authoring.md` — how a pack is built end-to-end.
- `ARCHITECTURE.md` — three-layer model, X-Pack dispatch, AI-Trail schema.
