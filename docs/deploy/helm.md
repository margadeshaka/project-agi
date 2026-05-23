<!--
  SPDX-FileCopyrightText: 2026 project-agi contributors
  SPDX-License-Identifier: Apache-2.0
-->

# Helm values reference

This file documents every key in
`distribution/agi-chart/values.yaml`. The chart enforces shape via
`values.schema.json`, so a typo or wrong type will surface as a `helm
install` error rather than a silent runtime misbehaviour.

## global

| Key | Type | Default | Purpose |
|---|---|---|---|
| `global.basePath` | string | `/` | URL prefix the runtime mounts under (for shared-ingress multi-tenant setups). |
| `global.imagePullSecrets` | list[object] | `[]` | Pre-existing pull secrets to attach to every pod. |
| `global.hardening.mode` | `multi` \| `single` | `multi` | `single` flips runtime into one-pack-per-pod (sets `AGI_HARDEN=1`). |
| `global.hardening.pack` | string | `""` | Required when `mode=single`; the slug of the pack to load. |

## imagePullSecret

Optional: have the chart manage a GHCR pull secret for you.

| Key | Type | Default | Purpose |
|---|---|---|---|
| `imagePullSecret.create` | bool | `false` | Create a `kubernetes.io/dockerconfigjson` Secret. |
| `imagePullSecret.name` | string | `agi-ghcr` | Name to use; also injected as an imagePullSecret on every pod. |
| `imagePullSecret.dockerconfigjson` | string | `""` | Base64-encoded contents of `~/.docker/config.json`. Required when `create=true`. |

## serviceAccount + rbac

| Key | Type | Default | Purpose |
|---|---|---|---|
| `serviceAccount.create` | bool | `true` | Create a dedicated SA for the workload. |
| `serviceAccount.name` | string | `""` | Override the auto-derived SA name. |
| `serviceAccount.annotations` | object | `{}` | Annotations on the SA (useful for IRSA / Workload Identity). |
| `rbac.create` | bool | `true` | Create the pack-reader Role + RoleBinding. |

## runtime

The agi-runtime container surface.

| Key | Type | Default | Notes |
|---|---|---|---|
| `runtime.enabled` | bool | `true` | Toggle the runtime entirely. |
| `runtime.replicaCount` | int | `2` | Ignored when `autoscaling.enabled=true`. |
| `runtime.hardeningMode` | bool | `false` | Sets `AGI_HARDEN=1` independently of `global.hardening.mode`. |
| `runtime.image.repository` | string | `ghcr.io/margadeshaka/agi-runtime` | |
| `runtime.image.tag` | string | `""` -> Chart.AppVersion | Pin in production. |
| `runtime.image.pullPolicy` | enum | `IfNotPresent` | |
| `runtime.service.type` | enum | `ClusterIP` | |
| `runtime.service.port` | int | `9000` | |
| `runtime.resources.{requests,limits}` | object | see file | Bumped from POC defaults to production-shaped. |
| `runtime.podSecurityContext` | object | nonRoot+seccomp | Bound to UID 1001. |
| `runtime.securityContext` | object | drop ALL caps, RO root FS | |
| `runtime.podAntiAffinity.enabled` | bool | `true` | Spread replicas across nodes. |
| `runtime.autoscaling.enabled` | bool | `true` | Enables HPA. |
| `runtime.autoscaling.minReplicas` | int | `2` | |
| `runtime.autoscaling.maxReplicas` | int | `10` | |
| `runtime.autoscaling.targetCPUUtilizationPercentage` | int | `70` | |
| `runtime.autoscaling.targetMemoryUtilizationPercentage` | int | `80` | |
| `runtime.pdb.enabled` | bool | `true` | Creates a PodDisruptionBudget. |
| `runtime.pdb.minAvailable` | int\|string | `1` | |
| `runtime.env` | map[string]string | see file | Extra env injected verbatim. |
| `runtime.packs.mode` | enum | `configmap` | `configmap` for small packs; `pvc` for bulky KB. |
| `runtime.packs.configMapName` | string | `""` | Auto-derived when empty. |
| `runtime.packs.pvc.claimName` | string | `""` | Required when `mode=pvc`. |
| `runtime.packs.pvc.mountPath` | string | `/packs` | |

## ui

The agi-ui admin console.

| Key | Type | Default | Notes |
|---|---|---|---|
| `ui.enabled` | bool | `true` | |
| `ui.replicaCount` | int | `2` | |
| `ui.image.{repository,tag,pullPolicy}` | object | ghcr.io/margadeshaka/agi-ui | |
| `ui.resources` | object | smaller than runtime | |
| `ui.podSecurityContext` / `ui.securityContext` | object | same posture as runtime | |

## auth

| Key | Type | Default | Notes |
|---|---|---|---|
| `auth.mode` | enum | `keycloak` | `dev-noop` is refused when `AGI_ENV=production`. |
| `auth.oidc.issuer` | string | `""` | **Required for keycloak/static.** |
| `auth.oidc.audience` | string | `agi-runtime` | JWT `aud` claim to verify. |
| `auth.oidc.tenantClaim` | string | `tenant_id` | Claim name carrying the tenant for X-Pack dispatch. |
| `auth.oidc.jwksUrl` | string | `""` | Auto-derived from issuer when empty. |

## llm

| Key | Type | Default | Notes |
|---|---|---|---|
| `llm.provider` | enum | `bedrock` | One of `bedrock` / `ollama` / `openai` / `anthropic` / `fake`. |
| `llm.env` | map | `{}` | Provider-specific env. Put secrets in `extraEnvFrom`. |

## storage + vectorStore

| Key | Type | Default | Notes |
|---|---|---|---|
| `storage.backend` | enum | `mongodb` | |
| `storage.mongoUri` | string | `""` | Connection string. |
| `storage.postgresUrl` | string | `""` | Used when `backend=postgres`. |
| `vectorStore.backend` | string | `qdrant` | |
| `vectorStore.url` | string | `""` | |

## observability

| Key | Type | Default | Notes |
|---|---|---|---|
| `observability.langfuse.host` | string | `""` | Base URL. OTLP endpoint is built as `${host}/api/public/otel`. |
| `observability.otelCollector.enabled` | bool | `true` | Adds an OTel collector sidecar to the runtime pod. |
| `observability.otelCollector.image.{repository,tag}` | object | otel/opentelemetry-collector-contrib:0.105.0 | |
| `observability.otelCollector.resources` | object | small | |

## networkPolicy

| Key | Type | Default | Notes |
|---|---|---|---|
| `networkPolicy.enabled` | bool | `true` | Default-deny + selective egress. Disable for clusters whose CNI does not implement NetworkPolicy. |
| `networkPolicy.egress.dns` | bool | `true` | Allow DNS to kube-system. |
| `networkPolicy.egress.cidrs` | list[string] | `[]` | Static egress allow-list. |
| `networkPolicy.egress.fqdns` | list[string] | bedrock, openai, anthropic | DNS-name allow-list (Cilium/Calico extension). |

## ingress

Same as upstream Helm chart convention. `service: "ui"` or `"runtime"`
per path entry.

## tests

`tests.image` controls the curl image used by `helm test`. Bump the tag
when CVEs warrant it.

## extraEnv / extraEnvFrom

Vanilla pass-through onto the runtime container. `extraEnvFrom` is the
right place for `secretRef:` blocks carrying provider credentials.
