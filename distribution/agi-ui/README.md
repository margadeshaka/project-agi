# agi-ui

Reference Admin Console for the project-agi runtime (Band 2 — Reference
Distribution). Next.js 14 + Tailwind v4 + shadcn/ui patterns.

Implements the surface in `CONSOLE_REQUIREMENTS.html`.

## Develop

```bash
npm install
npm run dev          # http://localhost:8080
```

Set `AGI_RUNTIME_URL=http://localhost:9000` to point at a local runtime.
The browser never talks to the runtime directly — it goes through the
same-origin proxy at `/api/runtime/*` so the session bearer never lands
in JavaScript.

## Build

```bash
npm run build
docker build -t agi-ui:dev .
```

Image budget: < 60 MB compressed (Next.js standalone output on alpine).

## Routes (v1, P4 iterations 4a + 4b + 4c)

| Path | Requirement |
|------|-------------|
| `/` | Health dashboard — FR-IA-02 |
| `/sign-in` | OIDC entry — FR-AUTH-01 |
| `/packs` | Pack list — FR-PACK-01 |
| `/packs/[slug]/overview` | Pack detail + reload — FR-PACK-01/02 |
| `/packs/[slug]/tools` | Pack-scoped tools — FR-TOOL-01 |
| `/packs/[slug]/kb` | KB browser + upload + reindex — FR-KB-01/02/03 |
| `/packs/[slug]/prompts` | Read-only prompts viewer — FR-PACK-03 |
| `/tools` | Cross-pack tool catalogue — FR-TOOL-01 |
| `/tools/[name]` | Tool detail + test-invoke — FR-TOOL-02/03/04 |
| `/use-cases` | Use-case service registry |
| `/llm` | Model role bindings (read-only) — FR-LLM-01 |
| `/audit` | AI-Trail list — FR-TRAIL-01 |
| `/audit/[correlation_id]` | Run event tree — FR-TRAIL-02/03 |
| `/admin/users` | OIDC identities — FR-ADM-02 |
| `/admin/log` | Admin action log — FR-ADM-01 |
| `/admin/settings` | Operator config (read-only) — FR-ADM-03 |

## Architecture

```
Browser ──/api/runtime/*──→ Next.js server ──Authorization──→ agi-runtime
                                                              │
                                                              ↓
                                                          Mongo / Vector / LLM
```

- **`app/components/runtime-fetch.ts`** — the single allowed entry point
  for API calls. Injects `Authorization` + `X-Pack`, normalises RFC 9457
  problem-details into `RuntimeError`.
- **`app/components/auth-provider.tsx`** — React context, calls
  `/api/auth/session` which reads the httpOnly bearer cookie and asks the
  runtime to resolve claims.
- **`app/components/sidebar.tsx`** — role-aware nav. Hides items the user
  lacks scope for. UI hiding is **never** the security boundary; the
  runtime rejects forbidden requests independently.
- **`app/components/pack-switcher.tsx`** — top-bar pack selector. Writes a
  cookie + reloads; runtime validates `X-Pack` against the JWT tenant
  claim (FR-AUTH-03).

## Lint, test, type-check

```bash
npm run lint          # next lint + check-no-hex
npm run type-check    # tsc --noEmit
npm run test          # vitest (component + filter unit tests)
npm run e2e           # playwright smoke
```

The `scripts/check-no-hex.ts` step fails the build if a hex literal lands
in any `.ts`/`.tsx` outside `app/styles/`. Enforces **NFR-THM-01**.

## Theming

CSS variables in `app/styles/tokens.css` (`--agi-bg`, `--agi-fg`,
`--agi-accent`, …) drive every brand token. The Tailwind config maps them
to utility classes (`bg-accent`, `text-foreground`, etc.). Per
`ADMIN_CONSOLE.md` §6, the console chrome stays neutral — only the pack
overview "Theme preview" card surfaces the active pack's tokens.

Dark/light follows `prefers-color-scheme` (NFR-THM-02).

## Security

- CSP headers (`next.config.js`): `connect-src 'self'`, no inline scripts in prod.
- Session cookie is httpOnly + secure + SameSite=Lax (NFR-SEC-02).
- Refresh-token rotation: server-only via the proxy.
- Image: distroless Node 20 alpine; standalone Next output (`<60 MB`).

## Not yet wired (P5 follow-up)

- Auth.js (NextAuth v5) full PKCE flow — current `/api/auth/oidc/start`
  is a thin redirect.
- TanStack Query client cache — pages are server-rendered with `cache:
  'no-store'`; lift to TanStack when client-side mutations need optimistic
  updates beyond the toast pattern.
- json-schema-to-zod for deeply nested tool input schemas (current panel
  handles primitives + enums + simple objects).
