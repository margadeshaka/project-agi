# agi-auth

Reference auth adapters for project-agi.

| Adapter | When to use | Env |
|---------|-------------|-----|
| `KeycloakAdapter` | Production (and any OIDC IdP) | `AGI_AUTH=keycloak`, `AGI_OIDC_ISSUER`, `AGI_OIDC_AUDIENCE` |
| `StaticTokenAdapter` | CI / fixtures | `AGI_AUTH=static`, `AGI_STATIC_TOKEN`, `AGI_STATIC_TENANT` |
| `DevNoopAdapter` | Local dev only — refuses to start in prod | `AGI_AUTH=dev-noop` |

All adapters return a normalized `Claims(sub, tenant_id, scopes)`. The
runtime dispatch layer enforces `claims.tenant_id == X-Pack` on every
request.
